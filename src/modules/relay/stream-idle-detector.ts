// StreamIdleDetector — docs/TECHNICAL.md §RTMP relay, Build order step 6 +
// §Sidecar software design "Modules".
//
// Per-broadcast submodule (not a singleton) that detects when the stream
// is idle (connected but no data flowing) vs. live. Owns no timer of its
// own — rides the StreamStatsSession's existing cadence via
// StreamStatUpdated subscriptions. One active stream still only ever has
// one timer in the whole process.
//
// Emits StreamIdle once (not per tick — a flag prevents duplicate emits)
// when N consecutive ticks show no meaningful bytesIn growth. Emits
// StreamResumed once when growth resumes. N is configurable per IDLE_THRESHOLD.

import type { EventBus } from "../../infra/event-bus.ts";
import type { Logger } from "../../infra/logger.ts";
import type { StreamSubmodule } from "./stream-orchestrator.ts";

// Idle threshold: 3 consecutive stats ticks with no growth in bytesIn
// before declaring the stream idle. At 1-second intervals (StreamStatsSession's
// cadence), that's ~3 seconds of no data before idle fires — reasonable
// margin to avoid false positives from brief network jitter while still
// catching actual stalls quickly.
const IDLE_THRESHOLD = 3;

// Minimum bytes increase per tick to count as "growth." Without this,
// a stream that sent exactly 0 bytes would trigger idle immediately,
// which is correct, but also a stream that sent 1 byte per tick wouldn't
// — clarify the threshold. 1 KB/tick is ~1 Mbps at 1-second intervals,
// well below typical audio/video bitrate, so effectively "any real growth."
const MIN_GROWTH_BYTES = 1024;

export class StreamIdleDetector implements StreamSubmodule {
  readonly #eventBus: EventBus;
  readonly #streamKey: string;
  #lastBytesIn = 0;
  #ticksWithoutGrowth = 0;
  #isIdle = false;
  #disposed = false;

  constructor(eventBus: EventBus, _logger: Logger, streamKey: string) {
    this.#eventBus = eventBus;
    this.#streamKey = streamKey;
  }

  start(): void {
    this.#eventBus.on("StreamStatUpdated", (payload) => {
      // EventBus.on() doesn't provide unsubscribe, so we check a disposed flag
      // to stop processing events after .dispose() is called.
      if (this.#disposed || payload.streamKey !== this.#streamKey) return;

      const growth = payload.bytesIn - this.#lastBytesIn;
      if (growth >= MIN_GROWTH_BYTES) {
        // Data flowing — reset the idle counter and emit StreamResumed if
        // we were idle.
        this.#ticksWithoutGrowth = 0;
        this.#lastBytesIn = payload.bytesIn;
        if (this.#isIdle) {
          this.#isIdle = false;
          this.#eventBus.emit("StreamResumed", {
            streamKey: this.#streamKey,
            at: payload.at,
          });
        }
      } else {
        // No meaningful growth — increment the idle counter.
        this.#ticksWithoutGrowth += 1;
        if (this.#ticksWithoutGrowth >= IDLE_THRESHOLD && !this.#isIdle) {
          // Just crossed the idle threshold.
          this.#isIdle = true;
          this.#eventBus.emit("StreamIdle", {
            streamKey: this.#streamKey,
            since: payload.at,
            at: payload.at,
          });
        }
      }
    });
  }

  dispose(): void {
    this.#disposed = true;
  }
}
