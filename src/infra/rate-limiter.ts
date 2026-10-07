// RateLimiter — in-memory token bucket for brute-force protection on login.
// Tracks attempts per {ip, email} tuple; multiple failed attempts trigger
// exponential backoff (5 attempts = 15min lockout, 10 = 1hr). Keys auto-expire
// to prevent unbounded memory growth.

export interface RateLimitConfig {
  maxAttempts: number;
  windowMs: number;
  lockoutMs?: number;
}

interface AttemptRecord {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

export class RateLimiter {
  #attempts = new Map<string, AttemptRecord>();
  #config: RateLimitConfig;

  constructor(config: RateLimitConfig = { maxAttempts: 5, windowMs: 15 * 60 * 1000 }) {
    this.#config = config;
    // Clean up expired entries every minute
    setInterval(() => this.#cleanup(), 60 * 1000);
  }

  check(ip: string | null, email: string): boolean {
    const key = `${ip}:${email}`;
    const now = Date.now();
    const record = this.#attempts.get(key);

    // New or expired record
    if (!record || record.resetAt < now) {
      this.#attempts.set(key, { count: 0, resetAt: now + this.#config.windowMs });
      return true;
    }

    // Account is locked
    if (record.lockedUntil && record.lockedUntil > now) {
      return false;
    }

    // Increment and check
    record.count++;
    if (record.count > this.#config.maxAttempts) {
      // Lock out: exponential backoff (each 5 attempts adds 15 min)
      const lockoutAttempts = Math.floor(record.count / 5);
      record.lockedUntil = now + 15 * 60 * 1000 * lockoutAttempts;
      return false;
    }

    return true;
  }

  getLockoutTime(ip: string | null, email: string): number | null {
    const key = `${ip}:${email}`;
    const record = this.#attempts.get(key);
    if (record?.lockedUntil) {
      const remaining = Math.max(0, record.lockedUntil - Date.now());
      return remaining > 0 ? remaining : null;
    }
    return null;
  }

  reset(ip: string | null, email: string): void {
    const key = `${ip}:${email}`;
    this.#attempts.delete(key);
  }

  #cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.#attempts) {
      // Remove if both window expired and lockout expired
      if (record.resetAt < now && (!record.lockedUntil || record.lockedUntil < now)) {
        this.#attempts.delete(key);
      }
    }
  }
}
