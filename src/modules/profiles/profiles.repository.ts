// DestinationProfileRepository — docs/TECHNICAL.md §Persistence & auth,
// `destination_profiles` collection. One document per user. Emits
// `DestinationCredentialsUpdated` per changed destination on write — the
// event schema is explicitly one-destination-per-event, so a PUT touching
// two destinations at once emits two events, not one summarizing both.

import { randomBytes } from "node:crypto";
import type { Collection, Db } from "mongodb";
import type { EventBus } from "../../infra/event-bus.ts";
import type { Destination } from "../../infra/events.ts";

export interface DestinationEntry {
  enabled: boolean;
  streamKey?: string;
  customIngestUrl?: string;
}

export interface DestinationProfileDoc {
  userId: string;
  ingestStreamKey: string;
  mixcloud: DestinationEntry;
  youtube: DestinationEntry;
  twitch: DestinationEntry;
  updatedAt: Date;
  updatedBy: string;
}

export type DestinationProfileUpdate = Partial<Record<Destination, Partial<DestinationEntry>>>;

const EMPTY_ENTRY: DestinationEntry = { enabled: false };

function generateIngestStreamKey(): string {
  return randomBytes(24).toString("hex");
}

export class DestinationProfileRepository {
  readonly #collection: Collection<DestinationProfileDoc>;

  constructor(
    db: Db,
    private readonly eventBus: EventBus,
  ) {
    this.#collection = db.collection<DestinationProfileDoc>("destination_profiles");
  }

  async init(): Promise<void> {
    await this.#collection.createIndex({ userId: 1 }, { unique: true });
  }

  async get(userId: string): Promise<DestinationProfileDoc | null> {
    // Project _id out — it's Mongo's own internal id, not part of the
    // documented Profile shape in openapi.yaml, and leaking it in an API
    // response is exactly the kind of thing that's easy to miss without
    // actually testing the response, not just the type signature.
    return this.#collection.findOne({ userId }, { projection: { _id: 0 } });
  }

  async exists(userId: string): Promise<boolean> {
    const count = await this.#collection.countDocuments({ userId }, { limit: 1 });
    return count > 0;
  }

  async upsert(
    userId: string,
    update: DestinationProfileUpdate,
    updatedBy: string,
  ): Promise<DestinationProfileDoc> {
    const existing = await this.#collection.findOne({ userId });
    const ingestStreamKey = existing?.ingestStreamKey ?? generateIngestStreamKey();

    const next: DestinationProfileDoc = {
      userId,
      ingestStreamKey,
      mixcloud: { ...(existing?.mixcloud ?? EMPTY_ENTRY), ...update.mixcloud },
      youtube: { ...(existing?.youtube ?? EMPTY_ENTRY), ...update.youtube },
      twitch: { ...(existing?.twitch ?? EMPTY_ENTRY), ...update.twitch },
      updatedAt: new Date(),
      updatedBy,
    };

    await this.#collection.replaceOne({ userId }, next, { upsert: true });

    const at = next.updatedAt;
    for (const destination of Object.keys(update) as Destination[]) {
      this.eventBus.emit("DestinationCredentialsUpdated", { userId, destination, at });
    }

    return next;
  }
}
