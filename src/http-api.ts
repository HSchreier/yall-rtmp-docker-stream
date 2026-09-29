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
// Static pages (setup/login/dashboard + app.js/app.css + the Modernist
// stylesheet) are read once at init() and served from memory — see
// docs/TECHNICAL.md's "read once at startup" design.
//
// Missing vs. openapi.yaml still: /stats, /events (SSE), the internal
// nginx-notify routes — those need StreamState/NginxProcessManager, which
// don't exist yet.

import { AppError } from "./infra/errors.ts";
import { jsonResponse, redirect } from "./infra/http.ts";
import { tryAuth } from "./infra/http-session.ts";
import type { Logger } from "./infra/logger.ts";
import type { AuthService } from "./modules/auth/auth.service.ts";
import type { UserRepository } from "./modules/users/users.repository.ts";

export interface ModuleRouter {
  handle(req: Request, url: URL): Promise<Response | undefined>;
}

interface HttpApiDeps {
  auth: AuthService;
  users: UserRepository;
  routers: ModuleRouter[];
  logger: Logger;
  httpPort: number;
}

interface StaticAsset {
  body: string;
  contentType: string;
}

const STATIC_DIR = new URL("./static/", import.meta.url);
const MODERNIST_CSS_PATH = new URL("../assets/design-system/modernist/styles.css", import.meta.url);

const STATIC_FILES: Array<{ route: string; file: URL; contentType: string }> = [
  { route: "/setup.html", file: new URL("setup.html", STATIC_DIR), contentType: "text/html" },
  { route: "/login.html", file: new URL("login.html", STATIC_DIR), contentType: "text/html" },
  {
    route: "/dashboard.html",
    file: new URL("dashboard.html", STATIC_DIR),
    contentType: "text/html",
  },
  {
    route: "/app.js",
    file: new URL("app.js", STATIC_DIR),
    contentType: "application/javascript",
  },
  {
    route: "/template.js",
    file: new URL("template.js", STATIC_DIR),
    contentType: "application/javascript",
  },
  { route: "/app.css", file: new URL("app.css", STATIC_DIR), contentType: "text/css" },
  { route: "/modernist.css", file: MODERNIST_CSS_PATH, contentType: "text/css" },
];

export class HttpApi {
  #server: ReturnType<typeof Bun.serve> | undefined;
  readonly #assets = new Map<string, StaticAsset>();

  constructor(private readonly deps: HttpApiDeps) {}

  async init(): Promise<void> {
    for (const { route, file, contentType } of STATIC_FILES) {
      const body = await Bun.file(file).text();
      this.#assets.set(route, { body, contentType });
    }

    this.#server = Bun.serve({
      port: this.deps.httpPort,
      fetch: (req) => this.#handle(req),
    });
    this.deps.logger.info(
      { port: this.deps.httpPort, staticAssets: this.#assets.size },
      "HttpApi: listening",
    );
  }

  stop(): void {
    this.#server?.stop();
  }

  async #handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    try {
      return await this.#route(req, url);
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

  async #route(req: Request, url: URL): Promise<Response> {
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
      const response = await router.handle(req, url);
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
