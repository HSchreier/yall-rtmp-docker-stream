// Logger — docs/TECHNICAL.md §Error handling, logging & try/catch discipline.
// Constructed before every other singleton, including ConfigService, so even
// a config-validation failure logs cleanly. Structured stdout via Pino,
// chosen specifically for `redact` — hand-rolled scrubbing is easy to get
// subtly wrong and silently miss a field, and the same secret-leak risk the
// `secret-like-field-in-event-payload` Semgrep rule guards against for
// events exists identically in error contexts.
//
// DEBUG mode (DEBUG=1 env var): pretty-print via pino-pretty transport for
// development visibility. When compiled binary is used (production), transports
// can't resolve file paths, so we fall back to JSON. In development, server.sh
// prefers `bun run src/index.ts` which supports transports correctly.

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

const DEBUG = process.env.DEBUG === "1" || process.env.DEBUG === "true";
const LOG_LEVEL = process.env.LOG_LEVEL || (DEBUG ? "debug" : "info");

export class Logger {
  readonly #pino = pino(
    {
      level: LOG_LEVEL,
      redact: { paths: REDACT_PATHS, remove: true },
    },
    DEBUG
      ? pino.transport({
          target: "pino-pretty",
          options: {
            colorize: true,
            singleLine: false,
            translateTime: "SYS:standard",
            ignore: "pid,hostname",
          },
        })
      : undefined,
  );

  debug(context: Record<string, unknown>, message: string): void {
    this.#pino.debug(context, message);
  }

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
