// HealthRouter — owns /health. Tests actual connectivity to nginx and Mongo.
// ingestStatus is still "offline" until StreamState integration is complete.

import { jsonResponse } from "../../infra/http.ts";
import type { MongoService } from "../../infra/mongo-service.ts";

export class HealthRouter {
  constructor(private readonly mongo: MongoService) {}

  private async isNginxReachable(): Promise<boolean> {
    try {
      // Try to connect to nginx RTMP stats endpoint (port 8090)
      const response = await fetch("http://127.0.0.1:8090/", {
        method: "GET",
        signal: AbortSignal.timeout(2000),
      });
      return response.ok || response.status === 404; // 404 is fine — nginx is running
    } catch {
      return false; // Connection refused, timeout, or other error
    }
  }

  async handle(req: Request, url: URL, clientIp: string | null): Promise<Response | undefined> {
    if (url.pathname === "/health" && req.method === "GET") {
      const nginxReachable = await this.isNginxReachable();
      return jsonResponse(200, {
        ingestStatus: "offline",
        nginxReachable,
        mongoReachable: this.mongo.isConnected(),
        at: new Date().toISOString(),
      });
    }
    return undefined;
  }
}
