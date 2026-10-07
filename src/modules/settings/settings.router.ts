import type { ModuleRouter } from "../../http-api";
import { jsonResponse } from "../../infra/http";
import type { WaspFilter, WaspRule } from "../../infra/wasp-filter";

export class SettingsRouter implements ModuleRouter {
  constructor(private wasp: WaspFilter) {}

  async handle(req: Request, url: URL, clientIp: string | null): Promise<Response | undefined> {
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/settings/security/rules") {
      return this.handleGetRules();
    }

    if (req.method === "POST" && pathname === "/settings/security/rules") {
      return this.handleAddRule(req);
    }

    if (req.method === "PATCH" && pathname.match(/^\/settings\/security\/rules\/[^/]+$/)) {
      const ruleId = pathname.split("/").pop() ?? "";
      if (!ruleId) return jsonResponse(400, { error: "Invalid rule ID" });
      return this.handleUpdateRule(ruleId, req);
    }

    if (req.method === "DELETE" && pathname.match(/^\/settings\/security\/rules\/[^/]+$/)) {
      const ruleId = pathname.split("/").pop() ?? "";
      if (!ruleId) return jsonResponse(400, { error: "Invalid rule ID" });
      return this.handleDeleteRule(ruleId);
    }

    if (req.method === "GET" && pathname === "/settings/security/blocks") {
      return this.handleGetBlocks();
    }

    if (
      req.method === "POST" &&
      pathname.match(/^\/settings\/security\/blocks\/[^/]+\/whitelist$/)
    ) {
      const ip = pathname.split("/")[4] ?? "";
      if (!ip) return jsonResponse(400, { error: "Invalid IP" });
      return this.handleUnblockIp(ip);
    }

    if (req.method === "POST" && pathname === "/settings/security/allowlist") {
      return this.handleAddAllowlist(req);
    }

    if (req.method === "GET" && pathname === "/settings/security/allowlist") {
      return this.handleGetAllowlist();
    }

    if (req.method === "POST" && pathname === "/settings/security/toggle") {
      return this.handleToggleWasp(req);
    }

    return undefined;
  }

  private handleGetRules(): Response {
    const rules = this.wasp.getRules();
    return jsonResponse(200, { rules });
  }

  private async handleAddRule(req: Request): Promise<Response> {
    try {
      const rule = (await req.json()) as WaspRule;
      if (!rule.id || !rule.type || !rule.severity) {
        return jsonResponse(400, { error: "Missing required fields: id, type, severity" });
      }
      this.wasp.addRule(rule);
      return jsonResponse(201, { rule });
    } catch (e) {
      return jsonResponse(400, {
        error: `Invalid rule: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async handleUpdateRule(ruleId: string, req: Request): Promise<Response> {
    try {
      const updates = (await req.json()) as Partial<WaspRule>;
      this.wasp.updateRule(ruleId, updates);
      const rules = this.wasp.getRules();
      const updated = rules.find((r) => r.id === ruleId);
      return jsonResponse(200, { rule: updated });
    } catch (e) {
      if (e instanceof Error && e.message.includes("not found")) {
        return jsonResponse(404, { error: e.message });
      }
      return jsonResponse(400, {
        error: `Failed to update rule: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private handleDeleteRule(ruleId: string): Response {
    try {
      this.wasp.removeRule(ruleId);
      return jsonResponse(200, { ok: true });
    } catch {
      return jsonResponse(404, { error: `Rule not found: ${ruleId}` });
    }
  }

  private handleGetBlocks(): Response {
    const blocks = this.wasp.getActiveBlocks();
    const allowlist = this.wasp.getAllowlist();
    return jsonResponse(200, {
      active: blocks.map((b) => ({
        ip: b.ip,
        rule: b.rule,
        blockedAt: b.blockedAt.toISOString(),
        expiresAt: b.expiresAt?.toISOString() || null,
        pattern: b.pattern || null,
      })),
      allowlist,
    });
  }

  private handleUnblockIp(ip: string): Response {
    this.wasp.unblockIp(ip);
    return jsonResponse(200, { ok: true, unblocked: ip });
  }

  private async handleAddAllowlist(req: Request): Promise<Response> {
    try {
      const { cidr } = (await req.json()) as { cidr: string };
      if (!cidr) {
        return jsonResponse(400, { error: "Missing required field: cidr" });
      }
      this.wasp.addToAllowlist(cidr);
      return jsonResponse(200, { ok: true, cidr });
    } catch (e) {
      return jsonResponse(400, {
        error: `Invalid request: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private handleGetAllowlist(): Response {
    const allowlist = this.wasp.getAllowlist();
    return jsonResponse(200, { allowlist });
  }

  private async handleToggleWasp(req: Request): Promise<Response> {
    try {
      const { enabled } = (await req.json()) as { enabled: boolean };
      this.wasp.setEnabled(enabled);
      return jsonResponse(200, { ok: true, enabled });
    } catch (e) {
      return jsonResponse(400, {
        error: `Invalid request: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }
}
