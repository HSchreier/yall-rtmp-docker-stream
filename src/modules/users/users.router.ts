// UsersRouter — translates HTTP <-> UsersService only. Owns /users,
// /users/:userId/activate, /users/:userId (PATCH/DELETE). GET/activate/
// DELETE stay admin-only here (simple, unconditional — no reason to push
// that into the service). PATCH is NOT admin-only — it's also the
// self-service "my account" path, so the admin-vs-self distinction
// depends on who's being edited and what's being changed, which is real
// business logic. That nuance lives in UsersService.updateUser(), not
// scattered here — same reasoning as the /profile ownership check.

import { jsonResponse, readJson } from "../../infra/http.ts";
import { requireAuth } from "../../infra/http-session.ts";
import type { AuthService } from "../auth/auth.service.ts";
import type { UserPatch, UsersService } from "./users.service.ts";

const ACTIVATE_USER_RE = /^\/users\/([^/]+)\/activate$/;
const USER_RE = /^\/users\/([^/]+)$/;

export class UsersRouter {
  constructor(
    private readonly usersService: UsersService,
    private readonly auth: AuthService,
  ) {}

  async handle(req: Request, url: URL): Promise<Response | undefined> {
    const { pathname } = url;

    if (pathname === "/users/me" && req.method === "GET") {
      const session = requireAuth(req, this.auth);
      const user = await this.usersService.getSelf(session.userId);
      return jsonResponse(200, user);
    }

    if (pathname === "/users" && req.method === "GET") {
      const session = requireAuth(req, this.auth);
      this.auth.requireAdmin(session);
      const users = await this.usersService.listWithStatus();
      return jsonResponse(200, { users });
    }

    if (pathname === "/users" && req.method === "POST") {
      const session = requireAuth(req, this.auth);
      this.auth.requireAdmin(session);
      const body = await readJson<{ email: string; password: string; role?: string }>(req);
      const user = await this.usersService.createUser(body, session.userId);
      return jsonResponse(201, user);
    }

    const activateTargetId = pathname.match(ACTIVATE_USER_RE)?.[1];
    if (activateTargetId && req.method === "POST") {
      const session = requireAuth(req, this.auth);
      this.auth.requireAdmin(session);
      const result = await this.usersService.activateFor(activateTargetId, session.userId);
      return jsonResponse(200, result);
    }

    const targetUserId = pathname.match(USER_RE)?.[1];
    if (targetUserId && req.method === "PATCH") {
      const session = requireAuth(req, this.auth);
      const body = await readJson<UserPatch>(req);
      const updated = await this.usersService.updateUser(targetUserId, body, session);
      return jsonResponse(200, updated);
    }

    if (targetUserId && req.method === "DELETE") {
      const session = requireAuth(req, this.auth);
      this.auth.requireAdmin(session);
      await this.usersService.deleteUser(targetUserId, session.userId);
      return jsonResponse(200, { userId: targetUserId, deleted: true });
    }

    const streamKeyTargetId = pathname.match(/^\/users\/([^/]+)\/streamkey$/)?.[1];
    if (streamKeyTargetId && req.method === "GET") {
      const session = requireAuth(req, this.auth);
      const isSelf = session.userId === streamKeyTargetId;
      if (!isSelf && session.role !== "admin") {
        return jsonResponse(403, { error: "Forbidden" });
      }
      const streamKey = await this.usersService.getStreamKey(streamKeyTargetId);
      return jsonResponse(200, streamKey);
    }

    if (streamKeyTargetId && req.method === "POST") {
      const session = requireAuth(req, this.auth);
      const isSelf = session.userId === streamKeyTargetId;
      if (!isSelf && session.role !== "admin") {
        return jsonResponse(403, { error: "Forbidden" });
      }
      const streamKey = await this.usersService.regenerateStreamKey(
        streamKeyTargetId,
        session.userId,
      );
      return jsonResponse(200, streamKey);
    }

    return undefined;
  }
}
