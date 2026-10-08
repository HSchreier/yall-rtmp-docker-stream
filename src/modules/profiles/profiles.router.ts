// ProfilesRouter — translates HTTP <-> ProfileService only. Owns /profile
// (GET/PUT) and /profile/activate.

import { jsonResponse, readJson } from "../../infra/http.ts";
import { requireAuth } from "../../infra/http-session.ts";
import type { AuthService } from "../auth/auth.service.ts";
import type { DestinationProfileUpdate } from "./profiles.repository.ts";
import type { ProfileService } from "./profiles.service.ts";

export class ProfilesRouter {
  constructor(
    private readonly profiles: ProfileService,
    private readonly auth: AuthService,
  ) {}

  async handle(req: Request, url: URL, _clientIp: string | null): Promise<Response | undefined> {
    const { pathname } = url;

    if (pathname === "/profile" && req.method === "GET") {
      const user = requireAuth(req, this.auth);
      const doc = await this.profiles.get(user.userId);
      if (!doc) {
        return jsonResponse(404, { error: { code: "NOT_FOUND", message: "No profile yet" } });
      }
      return jsonResponse(200, doc);
    }

    if (pathname === "/profile" && req.method === "PUT") {
      const user = requireAuth(req, this.auth);
      const body = await readJson<DestinationProfileUpdate>(req);
      const doc = await this.profiles.upsert(user.userId, body, user.userId);
      return jsonResponse(200, doc);
    }

    if (pathname === "/profile/activate" && req.method === "POST") {
      const user = requireAuth(req, this.auth);
      const result = await this.profiles.activateOwn(user.userId);
      return jsonResponse(200, result);
    }

    return undefined;
  }
}
