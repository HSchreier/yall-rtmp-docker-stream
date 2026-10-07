// AuthRouter — translates HTTP <-> AuthService only. Owns /auth/register,
// /auth/login, /auth/logout, /me. Returns undefined for anything it doesn't
// match, so HttpApi can try the next module router.

import { AuthError } from "../../infra/errors.ts";
import { jsonResponse, readJson, sessionCookie } from "../../infra/http.ts";
import { requireAuth, tryAuth } from "../../infra/http-session.ts";
import { RateLimiter } from "../../infra/rate-limiter.ts";
import type { UserRepository } from "../users/users.repository.ts";
import type { AuthService, RegisterInput } from "./auth.service.ts";

export class AuthRouter {
  readonly #rateLimiter = new RateLimiter({ maxAttempts: 5, windowMs: 15 * 60 * 1000 });

  constructor(
    private readonly auth: AuthService,
    private readonly users: UserRepository,
  ) {}

  async handle(req: Request, url: URL, clientIp: string | null): Promise<Response | undefined> {
    const { pathname } = url;

    if (pathname === "/me" && req.method === "GET") {
      const session = requireAuth(req, this.auth);
      const user = await this.users.findById(session.userId);
      if (!user) throw new AuthError();
      return jsonResponse(200, { userId: user.userId, email: user.email, role: user.role });
    }

    if (pathname === "/auth/register" && req.method === "POST") {
      const body = await readJson<RegisterInput>(req);
      const actingUser = tryAuth(req, this.auth);
      const result = await this.auth.register(body, actingUser);
      return jsonResponse(200, result);
    }

    if (pathname === "/auth/login" && req.method === "POST") {
      const body = await readJson<{ email: string; password: string }>(req);

      // Rate limit: 5 attempts per 15 minutes
      if (!this.#rateLimiter.check(clientIp, body.email)) {
        const lockoutMs = this.#rateLimiter.getLockoutTime(clientIp, body.email);
        const retryAfterSec = lockoutMs ? Math.ceil(lockoutMs / 1000) : 900;
        const res = jsonResponse(429, {
          error: {
            code: "TOO_MANY_REQUESTS",
            message: "Too many login attempts. Try again later.",
          },
        });
        res.headers.append("Retry-After", String(retryAfterSec));
        return res;
      }

      const { token } = await this.auth.login(body.email, body.password);
      this.#rateLimiter.reset(clientIp, body.email);
      const res = jsonResponse(200, { token });
      res.headers.append("Set-Cookie", sessionCookie(token));
      return res;
    }

    if (pathname === "/auth/logout" && req.method === "POST") {
      const res = jsonResponse(200, { ok: true });
      res.headers.append("Set-Cookie", sessionCookie("", 0));
      return res;
    }

    return undefined;
  }
}
