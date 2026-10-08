// HealthRouter — owns /health. Tests actual connectivity to nginx and Mongo.
// ingestStatus is still "offline" until StreamState integration is complete.

import { jsonResponse } from "../../infra/http.ts";
import type { MongoService } from "../../infra/mongo-service.ts";
import { networkInterfaces } from "node:os";

function getLocalIpOrHostname(): string {
  // Priority 1: explicit env var (for staging/prod override)
  if (Bun.env.RTMP_RELAY_URL && Bun.env.RTMP_RELAY_URL !== "auto") {
    return Bun.env.RTMP_RELAY_URL;
  }

  // Priority 2: host IP env var (set by docker-compose or user)
  if (Bun.env.RTMP_HOST_IP) {
    const port = Bun.env.RTMP_PORT || "1935";
    return `rtmp://${Bun.env.RTMP_HOST_IP}:${port}`;
  }

  // Priority 3: Docker host.docker.internal (Mac/Windows Docker Desktop)
  const port = Bun.env.RTMP_PORT || "1935";
  return `rtmp://host.docker.internal:${port}`;
}

export class HealthRouter {
  readonly #rtmpRelayUrl: string;

  constructor(private readonly mongo: MongoService) {
    this.#rtmpRelayUrl = getLocalIpOrHostname();
  }

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
        rtmpRelayUrl: this.#rtmpRelayUrl,
        at: new Date().toISOString(),
      });
    }
    return undefined;
  }
}
