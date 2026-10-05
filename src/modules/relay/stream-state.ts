// StreamState — docs/TECHNICAL.md §RTMP relay, Build order step 5 +
// §Sidecar software design "Modules".
//
// Domain singleton tracking "what is happening with the stream right now":
// status (offline/live/idle), the active stream key, byte/bitrate counters,
// and timestamps. Public getters only; private setters driven solely by
// EventBus subscriptions (StreamStarted/StreamEnded/StreamIdle/StreamResumed/
// StreamStatUpdated). One mutable state object, overwritten in place — no
// history, no side effects, just data. Fully unit-testable with a fake
// EventBus, same pattern as event-bus.test.ts.
//
// EventBus listeners are synchronous (no awaits) — they're pure assignment
// — so no extra error handling needed beyond EventBus's own try/catch.

import type { EventBus } from "../../infra/event-bus.ts";
import type { IngestStatus } from "../../infra/events.ts";

export class StreamState {
  #status: IngestStatus = "offline";
  #streamKey: string | null = null;
  #bytesIn: number = 0;
  #bitrateKbps: number = 0;
  #startedAt: Date | null = null;
  #lastEventAt: Date | null = null;

  constructor(private readonly eventBus: EventBus) {}

  async init(): Promise<void> {
    this.eventBus.on("StreamStarted", (payload) => {
      this.#status = "live";
      this.#streamKey = payload.streamKey;
      this.#bytesIn = 0;
      this.#bitrateKbps = 0;
      this.#startedAt = payload.at;
      this.#lastEventAt = payload.at;
    });

    this.eventBus.on("StreamEnded", (payload) => {
      this.#status = "offline";
      this.#streamKey = null;
      this.#bytesIn = 0;
      this.#bitrateKbps = 0;
      this.#startedAt = null;
      this.#lastEventAt = payload.at;
    });

    this.eventBus.on("StreamIdle", (payload) => {
      this.#status = "idle";
      this.#lastEventAt = payload.at;
    });

    this.eventBus.on("StreamResumed", (payload) => {
      this.#status = "live";
      this.#lastEventAt = payload.at;
    });

    this.eventBus.on("StreamStatUpdated", (payload) => {
      this.#bytesIn = payload.bytesIn;
      this.#bitrateKbps = payload.bitrateKbps;
      this.#lastEventAt = payload.at;
    });
  }

  getStatus(): IngestStatus {
    return this.#status;
  }

  getStreamKey(): string | null {
    return this.#streamKey;
  }

  getBytesIn(): number {
    return this.#bytesIn;
  }

  getBitrateKbps(): number {
    return this.#bitrateKbps;
  }

  getStartedAt(): Date | null {
    return this.#startedAt;
  }

  getLastEventAt(): Date | null {
    return this.#lastEventAt;
  }
}
