// HttpApi — docs/TECHNICAL.md §Sidecar software design + §Error handling +
// §Frontend & first install. Built on Bun.serve, hand-rolled routing, no
// framework. Centralized error wrapper: AppError subclasses map to their
// status; anything else is a generic 500 with no internal detail leaked to
// the client, full detail to the logger.
//
// Static pages (setup/login/dashboard + app.js/app.css + the Modernist
// stylesheet) are read once at init() and served from memory — see
// docs/TECHNICAL.md's "read once at startup" design.
//
// TODAY'S SLICE — enough to actually use end-to-end, not the full route
// set from openapi.yaml yet: /health, /auth/register, /auth/login,
// /auth/logout, /me, /profile (GET/PUT), /profile/activate,
// /users/:userId/activate, plus the static pages and root routing. Two
// routes (/me, /auth/logout) exist here but aren't in openapi.yaml yet —
// discovered as genuinely necessary while building the UI (a browser needs
// a way to know who's logged in, and to clear an HttpOnly cookie it can't
// touch itself); openapi.yaml needs updating to match, not done yet.
//
// Missing vs. openapi.yaml still: /stats, /events (SSE), the internal
// nginx-notify routes — those need StreamState/NginxProcessManager, which
// don't exist yet. /health still hardcodes ingestStatus/nginxReachable.
//
// No request-body schema validation beyond what AuthService/repositories
// already do internally — a validation library is a follow-up.

import type { AuthService, JwtPayload, RegisterInput } from "./auth-service.ts";
import type {
  DestinationProfileRepository,
  DestinationProfileUpdate,
} from "./destination-profile-repository.ts";
import { AppError, AuthError, ValidationError } from "./errors.ts";
import type { Logger } from "./logger.ts";
import type { MongoService } from "./mongo-service.ts";
import type { RelayStateRepository } from "./relay-state-repository.ts";
import type { UserRepository } from "./user-repository.ts";

interface HttpApiDeps {
  auth: AuthService;
  users: UserRepository;
  destinationProfiles: DestinationProfileRepository;
  relayState: RelayStateRepository;
  mongo: MongoService;
  logger: Logger;
  httpPort: number;
}

interface StaticAsset {
  body: string;
  contentType: string;
}

const ACTIVATE_USER_RE = /^\/users\/([^/]+)\/activate$/;
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

    const staticAsset = this.#assets.get(pathname);
    if (staticAsset && req.method === "GET" && pathname !== "/setup.html") {
      return this.#serveAsset(pathname);
    }

    if (pathname === "/health" && req.method === "GET") {
      return jsonResponse(200, {
        ingestStatus: "offline",
        nginxReachable: false,
        mongoReachable: this.deps.mongo.isConnected(),
        at: new Date().toISOString(),
      });
    }

    if (pathname === "/me" && req.method === "GET") {
      const session = this.#requireAuth(req);
      const user = await this.deps.users.findById(session.userId);
      if (!user) throw new AuthError();
      return jsonResponse(200, { userId: user.userId, email: user.email, role: user.role });
    }

    if (pathname === "/auth/register" && req.method === "POST") {
      const body = await readJson<RegisterInput>(req);
      const actingUser = this.#tryAuth(req);
      const result = await this.deps.auth.register(body, actingUser);
      return jsonResponse(200, result);
    }

    if (pathname === "/auth/login" && req.method === "POST") {
      const body = await readJson<{ email: string; password: string }>(req);
      const { token } = await this.deps.auth.login(body.email, body.password);
      const res = jsonResponse(200, { token });
      res.headers.append("Set-Cookie", sessionCookie(token));
      return res;
    }

    if (pathname === "/auth/logout" && req.method === "POST") {
      const res = jsonResponse(200, { ok: true });
      res.headers.append("Set-Cookie", sessionCookie("", 0));
      return res;
    }

    if (pathname === "/profile" && req.method === "GET") {
      const user = this.#requireAuth(req);
      const doc = await this.deps.destinationProfiles.get(user.userId);
      if (!doc) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "No profile yet" } });
      }
      return jsonResponse(200, doc);
    }

    if (pathname === "/profile" && req.method === "PUT") {
      const user = this.#requireAuth(req);
      const body = await readJson<DestinationProfileUpdate>(req);
      const doc = await this.deps.destinationProfiles.upsert(user.userId, body, user.userId);
      return jsonResponse(200, doc);
    }

    if (pathname === "/profile/activate" && req.method === "POST") {
      const user = this.#requireAuth(req);
      await this.deps.relayState.setActive(user.userId, user.userId);
      return jsonResponse(200, {
        activeUserId: user.userId,
        activatedAt: new Date().toISOString(),
      });
    }

    const activateMatch = pathname.match(ACTIVATE_USER_RE);
    const targetUserId = activateMatch?.[1];
    if (targetUserId && req.method === "POST") {
      const user = this.#requireAuth(req);
      this.deps.auth.requireAdmin(user);
      await this.deps.relayState.setActive(targetUserId, user.userId);
      return jsonResponse(200, {
        activeUserId: targetUserId,
        activatedAt: new Date().toISOString(),
      });
    }

    return jsonResponse(404, { error: { code: "NOT_FOUND", message: "No such route" } });
  }

  async #routeRoot(req: Request): Promise<Response> {
    if (await this.deps.users.isEmpty()) {
      return redirect("/setup.html");
    }
    const session = this.#tryAuth(req);
    return redirect(session ? "/dashboard.html" : "/login.html");
  }

  #serveAsset(pathname: string): Response {
    const asset = this.#assets.get(pathname);
    if (!asset) throw new Error(`static asset not loaded: ${pathname}`);
    return new Response(asset.body, { headers: { "content-type": asset.contentType } });
  }

  #requireAuth(req: Request): JwtPayload {
    const user = this.#tryAuth(req);
    if (!user) throw new AuthError();
    return user;
  }

  #tryAuth(req: Request): JwtPayload | null {
    const authHeader = req.headers.get("authorization");
    if (authHeader?.startsWith("Bearer ")) {
      return this.deps.auth.verifyToken(authHeader.slice(7));
    }
    const cookieHeader = req.headers.get("cookie");
    const match = cookieHeader?.match(/(?:^|;\s*)session=([^;]+)/);
    const token = match?.[1];
    return token ? this.deps.auth.verifyToken(token) : null;
  }
}

function sessionCookie(token: string, maxAgeSeconds = 43200): string {
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ValidationError("Malformed JSON body");
  }
}
