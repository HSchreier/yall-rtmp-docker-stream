// Logger — docs/TECHNICAL.md §Error handling, logging & try/catch discipline.
// Constructed before every other singleton, including ConfigService, so even
// a config-validation failure logs cleanly. Structured stdout via Pino,
// chosen specifically for `redact` — hand-rolled scrubbing is easy to get
// subtly wrong and silently miss a field, and the same secret-leak risk the
// `secret-like-field-in-event-payload` Semgrep rule guards against for
// events exists identically in error contexts.
//
// No pretty-print transport: transports run pino's worker-thread mechanism,
// which resolves a script by file path — that's a real open question under
// `bun build --compile` (a compiled binary has no on-disk file tree to
// resolve against), so this stays plain JSON-to-stdout until that's verified.

import pino from "pino";

const REDACT_PATHS = [
  "*.password",
  "*.passwordHash",
  "*.ingestStreamKey",
  "*.mixcloud.streamKey",
  "*.youtube.streamKey",
  "*.twitch.streamKey",
  "*.token",
  "*.jwtSecret",
];

export class Logger {
  readonly #pino = pino({
    redact: { paths: REDACT_PATHS, remove: true },
  });

  info(context: Record<string, unknown>, message: string): void {
    this.#pino.info(context, message);
  }

  warn(context: Record<string, unknown>, message: string): void {
    this.#pino.warn(context, message);
  }

  error(context: Record<string, unknown>, message: string): void {
    this.#pino.error(context, message);
  }

  fatal(context: Record<string, unknown>, message: string): void {
    this.#pino.fatal(context, message);
  }
}
