// AdminRouter — admin-only control endpoints for nginx and system operations.
// All endpoints require admin authentication via Bearer token.
// Loopback-optional: these are privileged operations that should be restricted
// to authenticated admin users only, regardless of source IP.

import { AuthError } from "../../infra/errors.ts";
import { jsonResponse } from "../../infra/http.ts";
import type { AuthService } from "../auth/auth.service.ts";
import type { NginxProcessManager } from "../relay/nginx-process-manager.ts";

export class AdminRouter {
  constructor(
    private readonly auth: AuthService,
    private readonly nginxProcessManager: NginxProcessManager,
  ) {}

  async handle(req: Request, url: URL, _clientIp: string | null): Promise<Response | undefined> {
    const { pathname } = url;

    // All admin routes require authentication
    if (!pathname.startsWith("/admin/")) return undefined;

    // Extract bearer token from Authorization header
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      throw new AuthError("Admin access requires Bearer token");
    }

    const token = authHeader.slice(7);
    const decoded = this.auth.verifyToken(token);
    if (decoded?.role !== "admin") {
      throw new AuthError("Admin access required");
    }

    // Admin endpoints
    if (pathname === "/admin/nginx/start" && req.method === "POST") {
      return this.handleNginxStart();
    }
    if (pathname === "/admin/nginx/stop" && req.method === "POST") {
      return this.handleNginxStop();
    }
    if (pathname === "/admin/nginx/reload" && req.method === "POST") {
      return this.handleNginxReload();
    }
    if (pathname === "/admin/nginx/status" && req.method === "GET") {
      return this.handleNginxStatus();
    }

    return undefined;
  }

  private handleNginxStart(): Response {
    // nginx is started automatically on profile activation, not manually
    // but expose for completeness
    return jsonResponse(200, {
      message: "nginx managed by profile activation — start a profile to activate nginx",
      running: this.nginxProcessManager.isRunning(),
    });
  }

  private handleNginxStop(): Response {
    this.nginxProcessManager.dispose();
    return jsonResponse(200, {
      message: "nginx stop signal sent",
      running: this.nginxProcessManager.isRunning(),
    });
  }

  private handleNginxReload(): Response {
    // Reload is internal — triggered by profile changes, not exposed to admin
    return jsonResponse(400, {
      error: "nginx reload is automatic on profile changes",
    });
  }

  private handleNginxStatus(): Response {
    return jsonResponse(200, {
      running: this.nginxProcessManager.isRunning(),
      pid: this.nginxProcessManager.getPid(),
      lastExitCode: this.nginxProcessManager.getLastExitCode(),
      lastCrashError: this.nginxProcessManager.getLastCrashError(),
    });
  }
}
