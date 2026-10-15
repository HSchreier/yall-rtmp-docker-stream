// BroadcastRouter — translates HTTP <-> BroadcastService. Owns /api/broadcast/*
// endpoints for slot management, session control, and stats streaming.
//
// Routes:
//   POST /api/broadcast/go-live → { success, slotExpiry, activeEmail, myStatus }
//   POST /api/broadcast/end-set → { success, sessionHistory }
//   POST /api/broadcast/end-session/:email (admin) → { success }
//   GET /api/broadcast/stats → { inputKbps, audioKbps, videoKbps, ... }
//   GET /api/broadcast/history?email=:email&limit=50 → SessionHistoryEntry[]
//   GET /api/broadcast/stream (SSE) → slot/stat updates every 2s

import { jsonResponse } from "../../infra/http.ts";
import { requireAuth } from "../../infra/http-session.ts";
import type { AuthService } from "../auth/auth.service.ts";
import type { BroadcastService } from "./broadcast.service.ts";

export class BroadcastRouter {
  constructor(
    private readonly broadcast: BroadcastService,
    private readonly auth: AuthService,
  ) {}

  async handle(req: Request, url: URL, _clientIp: string | null): Promise<Response | undefined> {
    const { pathname, searchParams } = url;

    // POST /api/broadcast/go-live
    if (pathname === "/api/broadcast/go-live" && req.method === "POST") {
      const session = requireAuth(req, this.auth);
      const result = await this.broadcast.goLive(session.userId, session.userId);
      return jsonResponse(200, result);
    }

    // POST /api/broadcast/end-set
    if (pathname === "/api/broadcast/end-set" && req.method === "POST") {
      const session = requireAuth(req, this.auth);
      const result = await this.broadcast.endSet(session.userId);
      return jsonResponse(200, result);
    }

    // POST /api/broadcast/end-session/:email (admin only)
    const endSessionMatch = pathname.match(/^\/api\/broadcast\/end-session\/([^/]+)$/);
    if (endSessionMatch?.[1] && req.method === "POST") {
      const session = requireAuth(req, this.auth);
      this.auth.requireAdmin(session);
      const email = decodeURIComponent(endSessionMatch[1]);
      const result = await this.broadcast.endSessionAdmin(email, session.userId);
      return jsonResponse(200, result);
    }

    // GET /api/broadcast/stats
    if (pathname === "/api/broadcast/stats" && req.method === "GET") {
      requireAuth(req, this.auth);
      const stats = await this.broadcast.getStats();
      return jsonResponse(200, stats);
    }

    // GET /api/broadcast/history?email=:email&limit=50
    if (pathname === "/api/broadcast/history" && req.method === "GET") {
      requireAuth(req, this.auth);
      const email = searchParams.get("email") || "";
      const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "50", 10)), 500);
      const history = await this.broadcast.getHistory(email, limit);
      return jsonResponse(200, history);
    }

    // GET /api/broadcast/stream (SSE)
    if (pathname === "/api/broadcast/stream" && req.method === "GET") {
      const session = requireAuth(req, this.auth);
      return this.#handleSSE(session.userId);
    }

    return undefined;
  }

  #handleSSE(userId: string): Response {
    let isClosed = false;
    const encoder = new TextEncoder();

    // Create a ReadableStream that yields SSE messages
    const readable = new ReadableStream({
      start: (controller) => {
        const sendMessage = (data: unknown) => {
          if (isClosed) return;
          const json = JSON.stringify(data);
          const message = `data: ${json}\n\n`;
          try {
            controller.enqueue(encoder.encode(message));
          } catch {
            // Stream may be closed, ignore
          }
        };

        // Send initial state
        sendMessage({ type: "connected", userId, at: new Date().toISOString() });

        // Stat updates every 2 seconds
        const statsInterval = setInterval(async () => {
          if (isClosed) {
            clearInterval(statsInterval);
            return;
          }
          try {
            const stats = await this.broadcast.getStats();
            sendMessage({ type: "stats", ...stats, at: new Date().toISOString() });
          } catch {
            // Ignore errors
          }
        }, 2000);

        return () => {
          isClosed = true;
          clearInterval(statsInterval);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        };
      },

      cancel: () => {
        isClosed = true;
      },
    });

    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
      },
    });
  }
}
