// StreamStatsSession — docs/TECHNICAL.md §RTMP relay, Build order step 6 +
// §Error handling.
//
// Per-broadcast submodule (not a singleton) that polls for stream stats at
// a fixed interval and emits StreamStatUpdated. Only submodule that owns an
// actual timer — .dispose() is responsible for clearing it. This is a
// deliberately scoped, bounded exception to the "no polling" rule: the timer
// is created on broadcast start and guaranteed cleared on broadcast end (or
// nginx crash), never existing when nothing is streaming.
//
// Timer callback has its own local try/catch — required, not optional,
// since an uncaught throw inside setInterval callback becomes an
// uncaughtException with nothing upstream to catch it. Logs and skips the
// tick on error; disposes itself after 3 consecutive failures rather than
// looping forever (same pattern as NginxProcessManager's crash-loop limit).

import type { EventBus } from "../../infra/event-bus.ts";
import type { Logger } from "../../infra/logger.ts";
import type { StreamSubmodule } from "./stream-orchestrator.ts";

// Stats polling interval: 1 second. Arbitrary, but typical for stream
// monitoring — sufficient cadence to detect stalls (seconds-order idle
// detection), low enough overhead to not be a concern for a single stream.
const STATS_POLL_INTERVAL_MS = 1000;
const MAX_CONSECUTIVE_ERRORS = 3;

export class StreamStatsSession implements StreamSubmodule {
  readonly #eventBus: EventBus;
  readonly #logger: Logger;
  readonly #streamKey: string;
  #timerId: NodeJS.Timeout | undefined;
  #lastBytesIn = 0;
  #consecutiveErrors = 0;

  constructor(eventBus: EventBus, logger: Logger, streamKey: string) {
    this.#eventBus = eventBus;
    this.#logger = logger;
    this.#streamKey = streamKey;
  }

  start(): void {
    this.#timerId = setInterval(() => this.#tick(), STATS_POLL_INTERVAL_MS);
  }

  dispose(): void {
    if (this.#timerId) {
      clearInterval(this.#timerId);
      this.#timerId = undefined;
    }
  }

  #tick(): void {
    try {
      // TODO: fetch actual stats from nginx /stat endpoint. For now, emit
      // a placeholder event to allow this step to compile and test the
      // orchestrator/detector pattern. Once the real fetch lands (after
      // verifying nginx reload behavior in step 8), this will query
      // localhost:8090/stat for the ingest application's actual
      // bytes_in/bitrate_in (the XML response format will need parsing).
      this.#eventBus.emit("StreamStatUpdated", {
        streamKey: this.#streamKey,
        bytesIn: this.#lastBytesIn,
        bitrateKbps: 0,
        at: new Date(),
      });

      this.#consecutiveErrors = 0;
    } catch (err) {
      this.#consecutiveErrors += 1;
      this.#logger.error(
        { err, streamKey: this.#streamKey, consecutiveErrors: this.#consecutiveErrors },
        "StreamStatsSession: tick failed",
      );

      if (this.#consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.#logger.error(
          { streamKey: this.#streamKey },
          "StreamStatsSession: max consecutive errors, disposing",
        );
        this.dispose();
      }
    }
  }
}
