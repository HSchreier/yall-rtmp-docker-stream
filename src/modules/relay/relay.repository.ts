// RelayStateRepository — docs/TECHNICAL.md §Persistence & auth, `relay_state`
// collection: the single pointer to which profile is currently active.
// Fixed `_id` ("singleton") rather than a query-for-the-only-document
// pattern — makes "there is exactly one of these" a structural fact instead
// of an assumption every caller has to uphold.

import type { Collection, Db } from "mongodb";
import type { EventBus } from "../../infra/event-bus.ts";

interface RelayStateDoc {
  _id: "singleton";
  activeUserId: string;
  activatedAt: Date;
  activatedBy: string;
}

export class RelayStateRepository {
  readonly #collection: Collection<RelayStateDoc>;

  constructor(
    db: Db,
    private readonly eventBus: EventBus,
  ) {
    this.#collection = db.collection<RelayStateDoc>("relay_state");
  }

  async getActiveUserId(): Promise<string | null> {
    const doc = await this.#collection.findOne({ _id: "singleton" });
    return doc?.activeUserId ?? null;
  }

  async setActive(userId: string, activatedBy: string): Promise<Date> {
    const activatedAt = new Date();
    // No `_id` in the replacement document — the driver's typings exclude it
    // from a replace payload, and it isn't needed: on upsert, Mongo assigns
    // the new document the `_id` from an equality filter when the
    // replacement itself omits one.
    await this.#collection.replaceOne(
      { _id: "singleton" },
      { activeUserId: userId, activatedAt, activatedBy },
      { upsert: true },
    );
    this.eventBus.emit("ActiveProfileChanged", { userId, activatedBy, at: activatedAt });
    // Returned so callers (UsersService/ProfileService) report the exact
    // timestamp that was actually persisted and emitted, instead of taking
    // a second `new Date()` that could drift from it by a few ms.
    return activatedAt;
  }
}
