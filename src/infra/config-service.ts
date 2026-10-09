// ConfigService — docs/TECHNICAL.md §Sidecar software design.
// Parses & validates *bootstrap* env vars exactly once, in init(), not the
// constructor (see the two-phase contract in TECHNICAL.md). Not the
// destination stream keys — those live in Mongo per-user, see
// DestinationProfileRepository. Fails fast, before Mongo or anything else
// is touched.

import type { Logger } from "./logger.ts";

export interface BootstrapConfig {
  readonly mongoUri: string;
  readonly jwtSecret: string;
  readonly httpPort: number;
  // 32 raw bytes (64 hex chars) for AES-256-GCM — see infra/crypto.ts. A
  // dedicated key, not reused from jwtSecret: JWT signing and data-at-rest
  // encryption are different cryptographic purposes, and reusing one key
  // for both is exactly the kind of shortcut that turns into a real
  // vulnerability once either use case needs to rotate independently.
  readonly encryptionKey: Buffer;
}

const ENCRYPTION_KEY_HEX_RE = /^[0-9a-f]{64}$/i;

export class ConfigService {
  #config: BootstrapConfig | undefined;

  constructor(private readonly logger: Logger) {}

  init(): void {
    const mongoUri = process.env.MONGO_URI;
    const jwtSecret = process.env.JWT_SECRET;
    const encryptionKeyHex = process.env.ENCRYPTION_KEY;
    const httpPortRaw = process.env.HTTP_PORT ?? "8080";

    const missing: string[] = [];
    if (!mongoUri) missing.push("MONGO_URI");
    if (!jwtSecret) missing.push("JWT_SECRET");
    if (!encryptionKeyHex) missing.push("ENCRYPTION_KEY");
    if (missing.length > 0) {
      throw new Error(`ConfigService: missing required env var(s): ${missing.join(", ")}`);
    }

    // After guards above, these are guaranteed non-undefined.
    // Cast to string since guard proves non-null, not using ! to avoid Biome rule.
    if (!ENCRYPTION_KEY_HEX_RE.test(encryptionKeyHex as string)) {
      throw new Error(
        "ConfigService: ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes) — generate with `openssl rand -hex 32`",
      );
    }

    const httpPort = parseInt(httpPortRaw, 10);
    if (!Number.isInteger(httpPort) || httpPort <= 0) {
      throw new Error(`ConfigService: HTTP_PORT must be a positive integer, got "${httpPortRaw}"`);
    }

    this.#config = {
      mongoUri: mongoUri as string,
      jwtSecret: jwtSecret as string,
      httpPort,
      encryptionKey: Buffer.from(encryptionKeyHex as string, "hex"),
    };
    this.logger.info({ httpPort }, "ConfigService: bootstrap config validated");
  }

  get(): BootstrapConfig {
    if (!this.#config) {
      throw new Error("ConfigService.get() called before init()");
    }
    return this.#config;
  }
}
