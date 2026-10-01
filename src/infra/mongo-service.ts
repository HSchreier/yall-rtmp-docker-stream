// MongoService — docs/TECHNICAL.md §Sidecar software design + §Data objects
// "In-memory state". Owns the single MongoDB client/connection pool —
// everything that touches the database goes through this, not through ad
// hoc MongoClient instances. isConnected()/getLastConnectedAt()/getLastError()
// are updated only from the native driver's own connection topology events
// (push-based, not polled) — same getter/private-setter shape as StreamState.
//
// Those event handlers carry their own local try/catch: they're listeners on
// the driver's own emitter, not EventBus, so EventBus's centralized handling
// doesn't cover them — see docs/TECHNICAL.md §Error handling.

import { type Db, MongoClient, type ServerHeartbeatFailedEvent } from "mongodb";
import type { Logger } from "./logger.ts";

export class MongoService {
  #client: MongoClient | undefined;
  #db: Db | undefined;
  #connected = false;
  #lastConnectedAt: Date | undefined;
  #lastError: string | undefined;

  constructor(
    private readonly logger: Logger,
    private readonly mongoUri: string,
  ) {}

  async init(): Promise<void> {
    const client = new MongoClient(this.mongoUri);

    client.on("serverHeartbeatSucceeded", () => {
      try {
        this.#connected = true;
        this.#lastConnectedAt = new Date();
        this.#lastError = undefined;
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : err },
          "MongoService: serverHeartbeatSucceeded handler threw",
        );
      }
    });

    client.on("serverHeartbeatFailed", (event: ServerHeartbeatFailedEvent) => {
      try {
        this.#connected = false;
        this.#lastError =
          event.failure instanceof Error ? event.failure.message : String(event.failure);
      } catch (err) {
        this.logger.error(
          { err: err instanceof Error ? err.message : err },
          "MongoService: serverHeartbeatFailed handler threw",
        );
      }
    });

    await client.connect();
    this.#client = client;
    this.#db = client.db();
    this.logger.info({}, "MongoService: connected");
  }

  async close(): Promise<void> {
    await this.#client?.close();
  }

  db(): Db {
    if (!this.#db) throw new Error("MongoService.db() called before init()");
    return this.#db;
  }

  isConnected(): boolean {
    return this.#connected;
  }

  getLastConnectedAt(): Date | undefined {
    return this.#lastConnectedAt;
  }

  getLastError(): string | undefined {
    return this.#lastError;
  }
}
