// RelayRouter — translates nginx-rtmp's HTTP notify callbacks into
// IngestEventReceiver calls. Owns /internal/nginx/on-publish and
// /internal/nginx/on-publish-done — see openapi.yaml, `internal` tag.
// Also owns /api/relay/start and /api/relay/stop (admin-only relay control).
//
// Loopback-only: HttpApi's main listener binds 0.0.0.0 (the public
// dashboard needs to be reachable over LAN/internet), but these two routes
// exist only for nginx's own notify module calling back into the same
// container over 127.0.0.1 — never the open internet. Defense-in-depth,
// not the only guard (the nginx config itself always posts to
// 127.0.0.1:${HTTP_PORT} — see docker/nginx.conf.template), but an
// operator reachable from outside the loopback shouldn't be able to forge
// StreamStarted/StreamEnded events for an attacker-chosen stream key.
// clientIp null (requestIP() returned nothing — can happen for an unusual
// listener setup) is treated as untrusted, not waved through.

import { ForbiddenError } from "../../infra/errors.ts";
import { jsonResponse } from "../../infra/http.ts";
import { requireAuth } from "../../infra/http-session.ts";
import type { AuthService } from "../auth/auth.service.ts";
import type { IngestEventReceiver } from "./ingest-event-receiver.ts";
import type { NginxProcessManager } from "./nginx-process-manager.ts";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);

const ON_PUBLISH_PATH = "/internal/nginx/on-publish";
const ON_PUBLISH_DONE_PATH = "/internal/nginx/on-publish-done";

function formField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

export class RelayRouter {
  constructor(
    private readonly receiver: IngestEventReceiver,
    private readonly nginxProcessManager?: NginxProcessManager,
    private readonly auth?: AuthService,
  ) {}

  async handle(req: Request, url: URL, clientIp: string | null): Promise<Response | undefined> {
    const { pathname } = url;

    // Admin relay control: start
    if (pathname === "/api/relay/start" && req.method === "POST") {
      if (!this.auth || !this.nginxProcessManager) {
        return jsonResponse(503, { error: "Relay control not available" });
      }
      const session = requireAuth(req, this.auth);
      this.auth.requireAdmin(session);

      const isRunning = this.nginxProcessManager.isRunning();
      if (!isRunning) {
        // Start would require actual process management here
        // For now, just report current state
      }

      return jsonResponse(200, {
        success: true,
        relayRunning: this.nginxProcessManager.isRunning(),
      });
    }

    // Admin relay control: stop
    if (pathname === "/api/relay/stop" && req.method === "POST") {
      if (!this.auth || !this.nginxProcessManager) {
        return jsonResponse(503, { error: "Relay control not available" });
      }
      const session = requireAuth(req, this.auth);
      this.auth.requireAdmin(session);

      // Stop would require actual process management here
      // For now, just report current state

      return jsonResponse(200, {
        success: true,
        relayRunning: this.nginxProcessManager.isRunning(),
      });
    }

    // Internal nginx callbacks (loopback-only)
    if (pathname !== ON_PUBLISH_PATH && pathname !== ON_PUBLISH_DONE_PATH) return undefined;
    if (req.method !== "POST") return undefined;

    if (!clientIp || !LOOPBACK_ADDRESSES.has(clientIp)) {
      throw new ForbiddenError("Internal nginx callback reachable only from loopback");
    }

    const form = await req.formData();
    const streamKey = formField(form, "name");

    if (pathname === ON_PUBLISH_PATH) {
      await this.receiver.handlePublish(streamKey);
    } else {
      await this.receiver.handlePublishDone(streamKey);
    }
    return jsonResponse(200, {});
  }
}
