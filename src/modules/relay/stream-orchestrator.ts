// StreamOrchestrator — docs/TECHNICAL.md §RTMP relay, Build order step 6 +
// §Sidecar software design "Modules" + "No unscoped timers".
//
// Domain singleton owning the broadcast lifecycle. Doesn't itself know how to
// collect stats or detect idle — it's constructed with an injected list of
// submodule factories. On StreamStarted, calls every factory to create one
// submodule instance per stream and calls .start() on each. On StreamEnded
// or nginx.crashed, calls .dispose() on every live submodule — a broadcast's
// submodules never outlive the event that justified them. Adding a new
// per-stream concern later means writing one more submodule and adding it to
// the injected list, not touching the orchestrator itself.
//
// Critical invariant: .dispose() is called on BOTH StreamEnded and
// nginx.crashed, even if both events fire in a race. Calling .dispose()
// twice must not throw or double-fire cleanup — this guarantee is what "no
// leaked timer" rests on, and it deserves direct unit-test coverage.

import type { EventBus } from "../../infra/event-bus.ts";
import type { Logger } from "../../infra/logger.ts";

export interface StreamSubmodule {
  start(): void;
  dispose(): void;
}

export type StreamSubmoduleFactory = (
  eventBus: EventBus,
  logger: Logger,
  streamKey: string,
) => StreamSubmodule;

export class StreamOrchestrator {
  readonly #eventBus: EventBus;
  readonly #logger: Logger;
  readonly #factories: StreamSubmoduleFactory[];
  readonly #activeSubmodules: Map<string, StreamSubmodule[]> = new Map();

  constructor(eventBus: EventBus, logger: Logger, factories: StreamSubmoduleFactory[]) {
    this.#eventBus = eventBus;
    this.#logger = logger;
    this.#factories = factories;
  }

  async init(): Promise<void> {
    this.#eventBus.on("StreamStarted", (payload) => {
      this.#handleStreamStarted(payload.streamKey);
    });

    this.#eventBus.on("StreamEnded", (payload) => {
      this.#handleStreamEnded(payload.streamKey);
    });

    this.#eventBus.on("nginx.crashed", (_payload) => {
      // Dispose all active submodules on nginx crash, same as StreamEnded
      // — a dead nginx means any ongoing stats collection or idle detection
      // is no longer meaningful, whether or not the stream itself has
      // formally ended.
      for (const submodules of this.#activeSubmodules.values()) {
        for (const submodule of submodules) {
          this.#disposeSubmodule(submodule);
        }
      }
      this.#activeSubmodules.clear();
    });
  }

  #handleStreamStarted(streamKey: string): void {
    const submodules: StreamSubmodule[] = [];
    for (const factory of this.#factories) {
      const submodule = factory(this.#eventBus, this.#logger, streamKey);
      submodule.start();
      submodules.push(submodule);
    }
    this.#activeSubmodules.set(streamKey, submodules);
  }

  #handleStreamEnded(streamKey: string): void {
    const submodules = this.#activeSubmodules.get(streamKey);
    if (!submodules) return;

    for (const submodule of submodules) {
      this.#disposeSubmodule(submodule);
    }
    this.#activeSubmodules.delete(streamKey);
  }

  #disposeSubmodule(submodule: StreamSubmodule): void {
    try {
      submodule.dispose();
    } catch (err) {
      // Log but don't rethrow — one submodule's failed cleanup shouldn't
      // block disposing others.
      this.#logger.error(
        { err },
        "StreamOrchestrator: submodule.dispose() threw, continuing with others",
      );
    }
  }
}
