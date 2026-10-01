// DestinationProfileRepository — docs/TECHNICAL.md §Persistence & auth,
// `destination_profiles` collection. One document per user. Emits
// `DestinationCredentialsUpdated` per changed destination on write — the
// event schema is explicitly one-destination-per-event, so a PUT touching
// two destinations at once emits two events, not one summarizing both.
//
// Destination stream keys are the actual live RTMP credentials for
// someone's Mixcloud/YouTube/Twitch account — encrypted at rest
// (AES-256-GCM, see infra/crypto.ts) rather than stored as plaintext.
// Encrypt/decrypt happens only here, at the persistence boundary — every
// caller above this repository (services, routers, the dashboard) works
// with plaintext, same as before; this class is the only place that knows
// the value on disk isn't the value the user typed.
//
// `ingestStreamKey` (this app's own generated key, not a third-party
// credential) is deliberately left unencrypted for now — a future
// nginx-notify webhook needs to look a user up *by* this value, and GCM's
// random per-call IV means the same plaintext never produces the same
// ciphertext twice, which rules out an equality query without decrypting
// every document first. Flagged, not hidden — revisit once that webhook
// exists and either query pattern can be evaluated for real.

import { randomBytes } from "node:crypto";
import type { Collection, Db } from "mongodb";
import { decryptSecret, encryptSecret } from "../../infra/crypto.ts";
import type { EventBus } from "../../infra/event-bus.ts";
import type { Destination } from "../../infra/events.ts";

export interface DestinationEntry {
  enabled: boolean;
  streamKey?: string;
  customIngestUrl?: string;
}

// Ingest-side jitter tolerance, consumed by NginxConfigRenderer alongside
// this profile's destination keys — see docs/TECHNICAL.md, RTMP relay
// §Per-user buffer profile for the out_queue/out_cork/relay_buffer values
// each preset maps to and why "mobile" (not nginx-rtmp's own tighter
// defaults) is the default.
export type BufferProfile = "mobile" | "stable";
const DEFAULT_BUFFER_PROFILE: BufferProfile = "mobile";

export interface DestinationProfileDoc {
  userId: string;
  ingestStreamKey: string;
  mixcloud: DestinationEntry;
  youtube: DestinationEntry;
  twitch: DestinationEntry;
  bufferProfile: BufferProfile;
  updatedAt: Date;
  updatedBy: string;
}

export type DestinationProfileUpdate = Partial<Record<Destination, Partial<DestinationEntry>>> & {
  bufferProfile?: BufferProfile;
};

const EMPTY_ENTRY: DestinationEntry = { enabled: false };
const DESTINATIONS = ["mixcloud", "youtube", "twitch"] as const;

function generateIngestStreamKey(): string {
  return randomBytes(24).toString("hex");
}

export class DestinationProfileRepository {
  readonly #collection: Collection<DestinationProfileDoc>;

  constructor(
    db: Db,
    private readonly eventBus: EventBus,
    private readonly encryptionKey: Buffer,
  ) {
    this.#collection = db.collection<DestinationProfileDoc>("destination_profiles");
  }

  async init(): Promise<void> {
    await this.#collection.createIndex({ userId: 1 }, { unique: true });
  }

  #decryptDoc(doc: DestinationProfileDoc): DestinationProfileDoc {
    const decrypted = { ...doc };
    for (const dest of DESTINATIONS) {
      const entry = doc[dest];
      if (entry.streamKey) {
        decrypted[dest] = {
          ...entry,
          streamKey: decryptSecret(entry.streamKey, this.encryptionKey),
        };
      }
    }
    return decrypted;
  }

  #encryptDoc(doc: DestinationProfileDoc): DestinationProfileDoc {
    const encrypted = { ...doc };
    for (const dest of DESTINATIONS) {
      const entry = doc[dest];
      if (entry.streamKey) {
        encrypted[dest] = {
          ...entry,
          streamKey: encryptSecret(entry.streamKey, this.encryptionKey),
        };
      }
    }
    return encrypted;
  }

  async get(userId: string): Promise<DestinationProfileDoc | null> {
    // Project _id out — it's Mongo's own internal id, not part of the
    // documented Profile shape in openapi.yaml, and leaking it in an API
    // response is exactly the kind of thing that's easy to miss without
    // actually testing the response, not just the type signature.
    const doc = await this.#collection.findOne({ userId }, { projection: { _id: 0 } });
    return doc ? this.#decryptDoc(doc) : null;
  }

  async exists(userId: string): Promise<boolean> {
    const count = await this.#collection.countDocuments({ userId }, { limit: 1 });
    return count > 0;
  }

  // Cascade target when a user account is deleted — see UsersService.deleteUser().
  // A no-op, not an error, if the user never set up a profile.
  async delete(userId: string): Promise<void> {
    await this.#collection.deleteOne({ userId });
  }

  async upsert(
    userId: string,
    update: DestinationProfileUpdate,
    updatedBy: string,
  ): Promise<DestinationProfileDoc> {
    const existingRaw = await this.#collection.findOne({ userId });
    const existing = existingRaw ? this.#decryptDoc(existingRaw) : null;
    const ingestStreamKey = existingRaw?.ingestStreamKey ?? generateIngestStreamKey();

    const next: DestinationProfileDoc = {
      userId,
      ingestStreamKey,
      mixcloud: { ...(existing?.mixcloud ?? EMPTY_ENTRY), ...update.mixcloud },
      youtube: { ...(existing?.youtube ?? EMPTY_ENTRY), ...update.youtube },
      twitch: { ...(existing?.twitch ?? EMPTY_ENTRY), ...update.twitch },
      bufferProfile: update.bufferProfile ?? existing?.bufferProfile ?? DEFAULT_BUFFER_PROFILE,
      updatedAt: new Date(),
      updatedBy,
    };

    await this.#collection.replaceOne({ userId }, this.#encryptDoc(next), { upsert: true });

    // Iterate the known destination keys, not Object.keys(update) — update
    // can also carry `bufferProfile`, which isn't a Destination and has no
    // event of its own to emit.
    const at = next.updatedAt;
    for (const destination of DESTINATIONS) {
      if (update[destination]) {
        this.eventBus.emit("DestinationCredentialsUpdated", { userId, destination, at });
      }
    }

    return next;
  }
}
