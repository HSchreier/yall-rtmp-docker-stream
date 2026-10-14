import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { AuthError } from "../../infra/errors.ts";
import { jsonResponse } from "../../infra/http.ts";
import type { AuthService } from "../auth/auth.service.ts";

const LOG_DIR = "/app/.logs";

export class LogsRouter {
  constructor(private readonly auth: AuthService) {}

  async handle(req: Request, url: URL, _clientIp: string | null): Promise<Response | undefined> {
    const { pathname } = url;

    // All log routes require admin authentication
    if (!pathname.startsWith("/logs")) return undefined;

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

    // List logs endpoint
    if (pathname === "/logs" && req.method === "GET") {
      try {
        const files = await readdir(LOG_DIR).catch(() => []);
        const logs = await Promise.all(
          files
            .filter((f) => f.endsWith(".log"))
            .map(async (name) => {
              const path = join(LOG_DIR, name);
              const content = await readFile(path, "utf-8").catch(() => "");
              return { name, lines: content.split("\n").filter((l) => l.trim()).length };
            }),
        );

        return jsonResponse(200, { logs, total: logs.length });
      } catch (_err) {
        return jsonResponse(500, { error: "failed to list logs" });
      }
    }

    // Get specific log file endpoint
    if (pathname.startsWith("/logs/") && req.method === "GET") {
      try {
        const name = pathname.slice(6); // Remove /logs/
        // Prevent directory traversal
        if (!name.match(/^[a-z0-9.-]+\.log$/i)) {
          return jsonResponse(400, { error: "invalid log name" });
        }

        const path = join(LOG_DIR, name);
        const content = await readFile(path, "utf-8");
        return new Response(content, {
          status: 200,
          headers: { "Content-Type": "text/plain" },
        });
      } catch (_err) {
        return jsonResponse(404, { error: "log not found" });
      }
    }

    return undefined;
  }
}
