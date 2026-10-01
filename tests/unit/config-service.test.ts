import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConfigService } from "../../src/infra/config-service.ts";
import { Logger } from "../../src/infra/logger.ts";

const ENV_KEYS = ["MONGO_URI", "JWT_SECRET", "ENCRYPTION_KEY", "HTTP_PORT"] as const;
const VALID_ENCRYPTION_KEY = "11".repeat(32);
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const value = saved[k];
    if (value === undefined) delete process.env[k];
    else process.env[k] = value;
  }
});

describe("ConfigService", () => {
  test("init() throws when required env vars are missing", () => {
    const service = new ConfigService(new Logger());
    expect(() => service.init()).toThrow(/MONGO_URI, JWT_SECRET, ENCRYPTION_KEY/);
  });

  test("get() throws when called before init()", () => {
    const service = new ConfigService(new Logger());
    expect(() => service.get()).toThrow(/before init\(\)/);
  });

  test("init() succeeds and get() returns validated config, HTTP_PORT defaults to 8080", () => {
    process.env.MONGO_URI = "mongodb://localhost:27017/test";
    process.env.JWT_SECRET = "test-secret";
    process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;

    const service = new ConfigService(new Logger());
    service.init();

    expect(service.get()).toEqual({
      mongoUri: "mongodb://localhost:27017/test",
      jwtSecret: "test-secret",
      httpPort: 8080,
      encryptionKey: Buffer.from(VALID_ENCRYPTION_KEY, "hex"),
    });
  });

  test("init() throws on a non-numeric HTTP_PORT", () => {
    process.env.MONGO_URI = "mongodb://localhost:27017/test";
    process.env.JWT_SECRET = "test-secret";
    process.env.ENCRYPTION_KEY = VALID_ENCRYPTION_KEY;
    process.env.HTTP_PORT = "not-a-port";

    const service = new ConfigService(new Logger());
    expect(() => service.init()).toThrow(/HTTP_PORT must be a positive integer/);
  });

  test("init() throws when ENCRYPTION_KEY isn't exactly 64 hex characters", () => {
    process.env.MONGO_URI = "mongodb://localhost:27017/test";
    process.env.JWT_SECRET = "test-secret";
    process.env.ENCRYPTION_KEY = "too-short";

    const service = new ConfigService(new Logger());
    expect(() => service.init()).toThrow(/ENCRYPTION_KEY must be exactly 64 hex characters/);
  });
});
