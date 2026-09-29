// UsersRouter — translates HTTP <-> UsersService only. Owns /users and
// /users/:userId/activate (both admin-only). No orchestration happens
// here — UsersService.listWithStatus()/activateFor() own that.

import { jsonResponse } from "../../infra/http.ts";
import { requireAuth } from "../../infra/http-session.ts";
import type { AuthService } from "../auth/auth.service.ts";
import type { UsersService } from "./users.service.ts";

const ACTIVATE_USER_RE = /^\/users\/([^/]+)\/activate$/;

export class UsersRouter {
  constructor(
    private readonly usersService: UsersService,
    private readonly auth: AuthService,
  ) {}

  async handle(req: Request, url: URL): Promise<Response | undefined> {
    const { pathname } = url;

    if (pathname === "/users" && req.method === "GET") {
      const session = requireAuth(req, this.auth);
      this.auth.requireAdmin(session);
      const users = await this.usersService.listWithStatus();
      return jsonResponse(200, { users });
    }

    const targetUserId = pathname.match(ACTIVATE_USER_RE)?.[1];
    if (targetUserId && req.method === "POST") {
      const session = requireAuth(req, this.auth);
      this.auth.requireAdmin(session);
      const result = await this.usersService.activateFor(targetUserId, session.userId);
      return jsonResponse(200, result);
    }

    return undefined;
  }
}
