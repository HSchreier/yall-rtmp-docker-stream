// IngestEventReceiver — docs/TECHNICAL.md §RTMP relay, Build order step 3.
// Handles nginx-rtmp's on_publish / on_publish_done notify callbacks
// (docker/nginx.conf.template wires both to /internal/nginx/on-publish and
// /internal/nginx/on-publish-done, via RelayRouter). Fully unit-testable
// without a real nginx: parse a form field, check it against
// RelayStateRepository + DestinationProfileRepository, emit an event —
// same shape as every other service in this codebase.
//
// Stream-key check: nginx-rtmp's `name` form field is whatever path
// segment followed `rtmp://host/ingest/`, which for this project is always
// meant to be the active profile's own `ingestStreamKey`. There is at most
// one active profile at a time (RelayStateRepository is a singleton
// pointer), so "does `name` match the active profile's key" is the entire
// authorization check — no per-request scan for a matching key across all
// profiles, just a lookup of the one active user.
//
// Start-time tracking: a single in-memory timestamp, not a map keyed by
// stream key — same "only one profile is ever active" reasoning as above.
// Used only to compute StreamEnded.durationMs.
//
// totalBytesIn is honestly 0, not a best-effort guess: nginx-rtmp's
// on_publish_done callback carries no byte-count field, and the module
// that would track it (a per-broadcast stats session, driven by
// rtmp_stat's XML) doesn't exist yet — see docs/TECHNICAL.md build order,
// a later step. Flagged here rather than fabricated, same discipline as
// the Dockerfile docs' libssl-dev note.

import { ForbiddenError } from "../../infra/errors.ts";
import type { EventBus } from "../../infra/event-bus.ts";
import type { DestinationProfileRepository } from "../profiles/profiles.repository.ts";
import type { RelayStateRepository } from "./relay.repository.ts";

export class IngestEventReceiver {
  #startedAt: Date | null = null;

  constructor(
    private readonly destinationProfiles: DestinationProfileRepository,
    private readonly relayState: RelayStateRepository,
    private readonly eventBus: EventBus,
  ) {}

  async handlePublish(streamKey: string): Promise<void> {
    const activeUserId = await this.relayState.getActiveUserId();
    if (!activeUserId) {
      throw new ForbiddenError("No active profile — nothing is authorized to publish");
    }
    const profile = await this.destinationProfiles.get(activeUserId);
    if (!profile || profile.ingestStreamKey !== streamKey) {
      throw new ForbiddenError("Stream key does not match the active profile");
    }
    const at = new Date();
    this.#startedAt = at;
    this.eventBus.emit("StreamStarted", { streamKey, at });
  }

  async handlePublishDone(streamKey: string): Promise<void> {
    const at = new Date();
    const durationMs = this.#startedAt ? at.getTime() - this.#startedAt.getTime() : 0;
    this.#startedAt = null;
    this.eventBus.emit("StreamEnded", { streamKey, at, durationMs, totalBytesIn: 0 });
  }
}
