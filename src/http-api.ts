// HttpApi — docs/TECHNICAL.md §Sidecar software design + §Error handling +
// §Frontend & first install. Built on Bun.serve, no framework. Owns only
// three things: serving the static dashboard pages, deciding where "/"
// redirects, and dispatching everything else to the module router that
// matches — auth, users, profiles, health. Each of those owns its own
// routes and talks only to its own service; this class makes no domain
// decisions itself.
//
// Centralized error wrapper: AppError subclasses map to their status;
// anything else is a generic 500 with no internal detail leaked to the
// client, full detail to the logger.
//
// Static pages (setup/login/dashboard + app.js/template.js/app.css + the
// Modernist stylesheet) are imported as text at *build* time — not read
// from disk in init() — and embedded directly into the module graph. This
// isn't just a style choice: `Bun.file(new URL(path, import.meta.url))`
// does NOT get embedded by `bun build --compile` (confirmed by actually
// running the compiled binary from a directory with no src/ present — it
// throws `ENOENT ... /$bunfs/root/static/setup.html`, a real bug that
// would have silently broken every Docker deployment). A `with { type:
// "text" }` import is what `--compile` actually embeds; see
// src/types/text-assets.d.ts for the ambient module declarations tsc
// needs to type these. Side benefit: `bun --watch` now picks up edits to
// these files too, since they're real imports in the module graph —
// no more needing a manual restart after touching src/static/*.

import markSvg from "../assets/brand/mark.svg" with { type: "text" };
import mark32Path from "../assets/brand/mark-32.png" with { type: "file" };
import mark180Path from "../assets/brand/mark-180.png" with { type: "file" };
import modernistCss from "../assets/design-system/modernist/styles.css" with { type: "text" };
import { AppError } from "./infra/errors.ts";
import { jsonResponse, redirect } from "./infra/http.ts";
import { tryAuth } from "./infra/http-session.ts";
import type { Logger } from "./infra/logger.ts";
import type { AuthService } from "./modules/auth/auth.service.ts";
import type { UserRepository } from "./modules/users/users.repository.ts";
import appCss from "./static/app.css" with { type: "text" };
import appJs from "./static/app.js" with { type: "text" };
// Cast to string: bun-types claims *.html for its own unrelated HTMLBundle
// dev-server feature, so tsc sees these as HTMLBundle even though Bun's
// bundler actually resolves them as plain text at both dev and compile
// time per the `type: "text"` attribute — see text-assets.d.ts.
import dashboardHtmlRaw from "./static/dashboard.html" with { type: "text" };
import loginHtmlRaw from "./static/login.html" with { type: "text" };
import settingsHtmlRaw from "./static/settings.html" with { type: "text" };
import setupHtmlRaw from "./static/setup.html" with { type: "text" };
import templateJs from "./static/template.js" with { type: "text" };

const dashboardHtml = dashboardHtmlRaw as unknown as string;
const loginHtml = loginHtmlRaw as unknown as string;
const settingsHtml = settingsHtmlRaw as unknown as string;
const setupHtml = setupHtmlRaw as unknown as string;

export interface ModuleRouter {
  handle(req: Request, url: URL, clientIp: string | null): Promise<Response | undefined>;
}

interface HttpApiDeps {
  auth: AuthService;
  users: UserRepository;
  routers: ModuleRouter[];
  logger: Logger;
  httpPort: number;
}

interface StaticAsset {
  body: string | ArrayBuffer;
  contentType: string;
}

const STATIC_FILES: Array<{ route: string; body: string; contentType: string }> = [
  { route: "/setup.html", body: setupHtml, contentType: "text/html" },
  { route: "/login.html", body: loginHtml, contentType: "text/html" },
  { route: "/dashboard.html", body: dashboardHtml, contentType: "text/html" },
  { route: "/settings.html", body: settingsHtml, contentType: "text/html" },
  { route: "/app.js", body: appJs, contentType: "application/javascript" },
  { route: "/template.js", body: templateJs, contentType: "application/javascript" },
  { route: "/app.css", body: appCss, contentType: "text/css" },
  { route: "/modernist.css", body: modernistCss, contentType: "text/css" },
  { route: "/mark.svg", body: markSvg, contentType: "image/svg+xml" },
];

// Binary assets can't use the text loader — `with { type: "file" }` embeds
// the raw bytes in the compiled binary and gives back a path string;
// Bun.file() reads the actual bytes back from it at runtime. Verified with
// a minimal reproduction (embed a real PNG, run the compiled binary from a
// directory with no source file present, confirm the byte count matches)
// before wiring this in, same as the text-asset fix above.
const BINARY_STATIC_FILES: Array<{ route: string; path: string; contentType: string }> = [
  { route: "/mark-32.png", path: mark32Path, contentType: "image/png" },
  { route: "/mark-180.png", path: mark180Path, contentType: "image/png" },
];

export class HttpApi {
  #server: ReturnType<typeof Bun.serve> | undefined;
  readonly #assets = new Map<string, StaticAsset>();

  constructor(private readonly deps: HttpApiDeps) {}

  async init(): Promise<void> {
    for (const { route, body, contentType } of STATIC_FILES) {
      this.#assets.set(route, { body, contentType });
    }
    for (const { route, path, contentType } of BINARY_STATIC_FILES) {
      const body = await Bun.file(path).arrayBuffer();
      this.#assets.set(route, { body, contentType });
    }

    this.#server = Bun.serve({
      port: this.deps.httpPort,
      fetch: (req, server) => this.#handle(req, server),
    });
    this.deps.logger.info(
      { port: this.deps.httpPort, staticAssets: this.#assets.size },
      "HttpApi: listening",
    );
  }

  // dispose() — gracefully stop the HTTP server. Closes the listening socket
  // and allows in-flight requests to finish. Safe to call multiple times
  // (idempotent). Called during shutdown (SIGTERM handler).
  dispose(): void {
    if (!this.#server) return;
    this.#server.stop();
  }

  async #handle(req: Request, server: ReturnType<typeof Bun.serve>): Promise<Response> {
    const url = new URL(req.url);
    try {
      const clientIp = server.requestIP(req)?.address ?? null;
      return await this.#route(req, url, clientIp);
    } catch (err) {
      if (err instanceof AppError) {
        return jsonResponse(err.status, { error: { code: err.code, message: err.message } });
      }
      this.deps.logger.error(
        { err: err instanceof Error ? err.message : String(err), path: url.pathname },
        "HttpApi: unhandled error",
      );
      return jsonResponse(500, { error: { code: "INTERNAL", message: "Internal server error" } });
    }
  }

  async #route(req: Request, url: URL, clientIp: string | null): Promise<Response> {
    const { pathname } = url;

    if (pathname === "/" && req.method === "GET") {
      return this.#routeRoot(req);
    }

    if (pathname === "/setup.html" && req.method === "GET") {
      if (!(await this.deps.users.isEmpty())) {
        return redirect("/login.html?setup=done");
      }
      return this.#serveAsset("/setup.html");
    }

    if (pathname === "/login.html" && req.method === "GET") {
      // Symmetric with /setup.html above — reaching /login.html directly
      // (bookmark, back button, a stale tab) with no admin yet would
      // otherwise show a login form with nothing to log into.
      if (await this.deps.users.isEmpty()) {
        return redirect("/setup.html");
      }
      return this.#serveAsset("/login.html");
    }

    const staticAsset = this.#assets.get(pathname);
    if (
      staticAsset &&
      req.method === "GET" &&
      pathname !== "/setup.html" &&
      pathname !== "/login.html"
    ) {
      return this.#serveAsset(pathname);
    }

    for (const router of this.deps.routers) {
      const response = await router.handle(req, url, clientIp);
      if (response) return response;
    }

    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "No such route" } });
  }

  async #routeRoot(req: Request): Promise<Response> {
    if (await this.deps.users.isEmpty()) {
      return redirect("/setup.html");
    }
    const session = tryAuth(req, this.deps.auth);
    return redirect(session ? "/dashboard.html" : "/login.html");
  }

  #serveAsset(pathname: string): Response {
    const asset = this.#assets.get(pathname);
    if (!asset) throw new Error(`static asset not loaded: ${pathname}`);
    return new Response(asset.body, { headers: { "content-type": asset.contentType } });
  }
}
