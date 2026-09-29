// AuthRouter — translates HTTP <-> AuthService only. Owns /auth/register,
// /auth/login, /auth/logout, /me. Returns undefined for anything it doesn't
// match, so HttpApi can try the next module router.

import { AuthError } from "../../infra/errors.ts";
import { jsonResponse, readJson, sessionCookie } from "../../infra/http.ts";
import { requireAuth, tryAuth } from "../../infra/http-session.ts";
import type { UserRepository } from "../users/users.repository.ts";
import type { AuthService, RegisterInput } from "./auth.service.ts";

export class AuthRouter {
  constructor(
    private readonly auth: AuthService,
    private readonly users: UserRepository,
  ) {}

  async handle(req: Request, url: URL): Promise<Response | undefined> {
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
      const { token } = await this.auth.login(body.email, body.password);
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
