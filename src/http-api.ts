// HttpApi — docs/TECHNICAL.md §Sidecar software design + §Error handling.
// Built on Bun.serve, hand-rolled routing, no framework. Centralized error
// wrapper: AppError subclasses map to their status; anything else is a
// generic 500 with no internal detail leaked to the client, full detail to
// the logger.
//
// TODAY'S SLICE — enough to actually test end-to-end, not the full route
// set from openapi.yaml yet: /health, /auth/register, /auth/login,
// /profile (GET/PUT), /profile/activate, /users/:userId/activate. Missing
// vs. openapi.yaml: /stats, /events (SSE), the static UI pages, the
// internal nginx-notify routes — those need StreamState/NginxProcessManager/
// the frontend, none of which exist yet. /health currently hardcodes
// ingestStatus and nginxReachable since StreamState and NginxProcessManager
// aren't built; only mongoReachable is real.
//
// No request-body schema validation beyond what AuthService/repositories
// already do internally (email format, password length, destination shape
// by TypeScript's own structural typing) — a validation library is a
// follow-up, not done today.

import type { AuthService, JwtPayload, RegisterInput } from "./auth-service.ts";
import type {
  DestinationProfileRepository,
  DestinationProfileUpdate,
} from "./destination-profile-repository.ts";
import { AppError, AuthError, ValidationError } from "./errors.ts";
import type { Logger } from "./logger.ts";
import type { MongoService } from "./mongo-service.ts";
import type { RelayStateRepository } from "./relay-state-repository.ts";

interface HttpApiDeps {
  auth: AuthService;
  destinationProfiles: DestinationProfileRepository;
  relayState: RelayStateRepository;
  mongo: MongoService;
  logger: Logger;
  httpPort: number;
}

const ACTIVATE_USER_RE = /^\/users\/([^/]+)\/activate$/;

export class HttpApi {
  #server: ReturnType<typeof Bun.serve> | undefined;

  constructor(private readonly deps: HttpApiDeps) {}

  init(): void {
    this.#server = Bun.serve({
      port: this.deps.httpPort,
      fetch: (req) => this.#handle(req),
    });
    this.deps.logger.info({ port: this.deps.httpPort }, "HttpApi: listening");
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

    if (pathname === "/health" && req.method === "GET") {
      return jsonResponse(200, {
        ingestStatus: "offline",
        nginxReachable: false,
        mongoReachable: this.deps.mongo.isConnected(),
        at: new Date().toISOString(),
      });
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
      res.headers.append(
        "Set-Cookie",
        `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
      );
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
