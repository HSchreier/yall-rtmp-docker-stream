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
}

export class ConfigService {
  #config: BootstrapConfig | undefined;

  constructor(private readonly logger: Logger) {}

  init(): void {
    const mongoUri = process.env.MONGO_URI;
    const jwtSecret = process.env.JWT_SECRET;
    const httpPortRaw = process.env.HTTP_PORT ?? "8080";

    const missing: string[] = [];
    if (!mongoUri) missing.push("MONGO_URI");
    if (!jwtSecret) missing.push("JWT_SECRET");
    if (missing.length > 0) {
      throw new Error(`ConfigService: missing required env var(s): ${missing.join(", ")}`);
    }

    const httpPort = Number(httpPortRaw);
    if (!Number.isInteger(httpPort) || httpPort <= 0) {
      throw new Error(`ConfigService: HTTP_PORT must be a positive integer, got "${httpPortRaw}"`);
    }

    this.#config = { mongoUri: mongoUri as string, jwtSecret: jwtSecret as string, httpPort };
    this.logger.info({ httpPort }, "ConfigService: bootstrap config validated");
  }

  get(): BootstrapConfig {
    if (!this.#config) {
      throw new Error("ConfigService.get() called before init()");
    }
    return this.#config;
  }
}
