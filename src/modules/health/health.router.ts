// HealthRouter — owns /health. Standalone (no service object) since there's
// no domain behavior to own yet, just a read of MongoService's own state —
// ingestStatus/nginxReachable are hardcoded until NginxProcessManager exists
// (see docs/TECHNICAL.md's build order).

import { jsonResponse } from "../../infra/http.ts";
import type { MongoService } from "../../infra/mongo-service.ts";

export class HealthRouter {
  constructor(private readonly mongo: MongoService) {}

  async handle(req: Request, url: URL): Promise<Response | undefined> {
    if (url.pathname === "/health" && req.method === "GET") {
      return jsonResponse(200, {
        ingestStatus: "offline",
        nginxReachable: false,
        mongoReachable: this.mongo.isConnected(),
        at: new Date().toISOString(),
      });
    }
    return undefined;
  }
}
