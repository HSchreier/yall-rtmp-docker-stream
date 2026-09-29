// EventBus — docs/TECHNICAL.md §Sidecar software design.
// The one thing every other singleton depends on. Each listener is wrapped
// in its own try/catch at registration time (not around `emit()`): Node's
// EventEmitter calls listeners for one event synchronously in sequence, so
// a listener that throws would otherwise abort the remaining listeners for
// that same emit — wrapping per-listener is what actually isolates them.
//
// This centralization covers only listeners registered through this class.
// Anything hooking into an emitter we didn't write (child_process, the
// MongoDB driver's own events, a raw setInterval callback) needs its own
// local try/catch — see docs/TECHNICAL.md, same section.

import { EventEmitter } from "node:events";
import type { EventMap } from "./events.ts";
import type { Logger } from "./logger.ts";

export class EventBus {
  readonly #emitter = new EventEmitter();

  constructor(private readonly logger: Logger) {
    // Fixed, small set of long-lived listeners registered once at startup —
    // not a per-request or per-connection source — so a static ceiling well
    // above the module count is the right guard against a real leak, not a
    // number to keep raising if it's ever hit.
    this.#emitter.setMaxListeners(50);
  }

  on<K extends keyof EventMap>(event: K, listener: (payload: EventMap[K]) => void): void {
    this.#emitter.on(event, (payload: EventMap[K]) => {
      try {
        listener(payload);
      } catch (err) {
        this.logger.error(
          { event, err: err instanceof Error ? err.message : err },
          `EventBus listener threw for "${String(event)}"`,
        );
      }
    });
  }

  emit<K extends keyof EventMap>(event: K, payload: EventMap[K]): void {
    this.#emitter.emit(event, payload);
  }
}
