import type { EventBus } from "./event-bus";
import type { SecurityEvent } from "./events";
import type { Logger } from "./logger";

export interface WaspRule {
  id: string;
  severity: "soft" | "medium" | "hard";
  type: "rate-limit" | "pattern" | "behavioral";
  enabled: boolean;
  description: string;
  threshold?: number; // req/sec for rate-limit
  window?: number; // seconds for rate-limit window
  pattern?: string; // regex for pattern-type rules
  fields?: string[]; // which request fields to check pattern against
  timeoutSecs: number; // auto-unblock timeout
}

export interface ActiveBlock {
  ip: string;
  rule: string;
  blockedAt: Date;
  expiresAt: Date | null;
  pattern?: string | undefined;
}

export class WaspFilter {
  private rules: Map<string, WaspRule> = new Map();
  private activeBlocks: Map<string, ActiveBlock> = new Map();
  // biome-ignore lint/suspicious/noExplicitAny: Bun setInterval return type incompatibility
  private expireTimer: any = null;
  private enabled: boolean;
  private requestCounts: Map<string, number[]> = new Map(); // IP → array of request timestamps
  private allowlist: Set<string> = new Set();

  constructor(
    private eventBus: EventBus,
    private logger: Logger,
    rules: WaspRule[] = [],
    enabled: boolean = false,
  ) {
    this.enabled = enabled;
    rules.forEach((rule) => {
      if (rule.enabled) {
        this.rules.set(rule.id, rule);
      }
    });
  }

  init() {
    if (!this.enabled) {
      this.logger.info({}, "WASP disabled");
      return;
    }
    this.logger.info({}, "WASP enabled — starting block expiry timer");
    this.expireTimer = setInterval((() => this.checkExpiredBlocks()) as () => void, 10_000);
  }

  dispose() {
    if (this.expireTimer !== null) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
    }
    this.rules.clear();
    this.activeBlocks.clear();
    this.requestCounts.clear();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled && this.expireTimer === null) {
      this.expireTimer = setInterval((() => this.checkExpiredBlocks()) as () => void, 10_000);
      this.logger.info({}, "WASP enabled");
    } else if (!enabled && this.expireTimer !== null) {
      clearInterval(this.expireTimer);
      this.expireTimer = null;
      this.activeBlocks.clear();
      this.logger.info({}, "WASP disabled — cleared active blocks");
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  addRule(rule: WaspRule) {
    this.rules.set(rule.id, rule);
    this.logger.info({ rule: rule.id }, "WASP rule added");
  }

  updateRule(ruleId: string, updates: Partial<WaspRule>) {
    const existing = this.rules.get(ruleId);
    if (!existing) {
      throw new Error(`Rule ${ruleId} not found`);
    }
    const updated = { ...existing, ...updates };
    this.rules.set(ruleId, updated);
    this.logger.info({ rule: ruleId, updates }, "WASP rule updated");
  }

  removeRule(ruleId: string) {
    this.rules.delete(ruleId);
    // Remove all blocks for this rule
    for (const [ip, block] of this.activeBlocks.entries()) {
      if (block.rule === ruleId) {
        this.activeBlocks.delete(ip);
      }
    }
    this.logger.info({ rule: ruleId }, "WASP rule removed");
  }

  getRules(): WaspRule[] {
    return Array.from(this.rules.values());
  }

  getActiveBlocks(): ActiveBlock[] {
    return Array.from(this.activeBlocks.values());
  }

  addToAllowlist(cidr: string) {
    this.allowlist.add(cidr);
    this.logger.info({ cidr }, "Added to WASP allowlist");
  }

  removeFromAllowlist(cidr: string) {
    this.allowlist.delete(cidr);
    this.logger.info({ cidr }, "Removed from WASP allowlist");
  }

  getAllowlist(): string[] {
    return Array.from(this.allowlist);
  }

  isAllowlisted(ip: string): boolean {
    // Simple allowlist check (could be expanded to proper CIDR matching)
    return this.allowlist.has(ip) || this.allowlist.has("127.0.0.1");
  }

  checkRequest(ip: string | null, url: string, headers: Record<string, string>): boolean {
    if (!this.enabled || !ip || this.isAllowlisted(ip)) {
      return true;
    }

    // Check if already blocked
    const existing = this.activeBlocks.get(ip);
    if (existing && (!existing.expiresAt || existing.expiresAt > new Date())) {
      return false;
    }

    // Remove expired hard blocks (medium/soft auto-expire, hard needs manual unblock)
    if (existing?.expiresAt && existing.expiresAt <= new Date()) {
      this.activeBlocks.delete(ip);
    }

    // Check each enabled rule
    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue;

      if (rule.type === "rate-limit") {
        if (this.checkRateLimit(ip, rule)) {
          return false;
        }
      } else if (rule.type === "pattern") {
        if (this.checkPattern(url, headers, rule)) {
          return false;
        }
      }
    }

    return true;
  }

  private checkRateLimit(ip: string, rule: WaspRule): boolean {
    if (!rule.threshold || !rule.window) return false;

    const now = Date.now();
    const windowMs = rule.window * 1000;
    let timestamps = this.requestCounts.get(ip) || [];

    // Remove old timestamps outside the window
    timestamps = timestamps.filter((t) => now - t < windowMs);

    // Check if over threshold
    if (timestamps.length >= rule.threshold) {
      this.blockIp(ip, rule.id, null, rule.timeoutSecs, "soft");
      this.requestCounts.set(ip, []);
      return true;
    }

    // Record this request
    timestamps.push(now);
    this.requestCounts.set(ip, timestamps);
    return false;
  }

  private checkPattern(url: string, headers: Record<string, string>, rule: WaspRule): boolean {
    if (!rule.pattern || !rule.fields) return false;

    const regex = new RegExp(rule.pattern, "i");
    const fieldsToCheck = [url, ...Object.values(headers)];

    if (fieldsToCheck.some((field) => typeof field === "string" && regex.test(field))) {
      this.blockIp(
        "unknown", // Will be filled in by caller with actual IP
        rule.id,
        rule.pattern,
        rule.timeoutSecs,
        rule.severity,
      );
      return true;
    }

    return false;
  }

  private blockIp(
    ip: string,
    ruleId: string,
    pattern: string | null,
    timeoutSecs: number,
    severity: string,
  ) {
    const now = new Date();
    const expiresAt = severity === "hard" ? null : new Date(now.getTime() + timeoutSecs * 1000);

    const block: ActiveBlock = {
      ip,
      rule: ruleId,
      blockedAt: now,
      expiresAt,
      ...(pattern && { pattern }),
    };

    this.activeBlocks.set(ip, block);

    // Emit security event for audit logging
    this.eventBus.emit("SecurityEvent", {
      ip,
      rule: ruleId,
      severity: severity as "soft" | "medium" | "hard",
      action: "blocked",
      ...(pattern && { pattern }),
      timeout: timeoutSecs,
      at: now,
    } as SecurityEvent);

    this.logger.warn(
      { ip, rule: ruleId, timeout: timeoutSecs, severity },
      `WASP: blocked ${ip} — rule ${ruleId}`,
    );
  }

  private checkExpiredBlocks() {
    const now = new Date();
    const expired: string[] = [];

    for (const [ip, block] of this.activeBlocks.entries()) {
      if (block.expiresAt && block.expiresAt <= now) {
        expired.push(ip);
        this.activeBlocks.delete(ip);
        this.eventBus.emit("BlockExpired", {
          ip,
          rule: block.rule,
          at: now,
        });
        this.logger.info({ ip, rule: block.rule }, "WASP block expired");
      }
    }
  }

  unblockIp(ip: string) {
    this.activeBlocks.delete(ip);
    this.logger.info({ ip }, "WASP block manually removed");
  }
}
