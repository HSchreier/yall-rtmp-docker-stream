// NginxProcessManager — docs/TECHNICAL.md §RTMP relay, Build order step 4
// + §Sidecar software design "Modules" + §Error handling "Crash-loop
// protection for nginx specifically".
//
// Spawns nginx with `-g "daemon off;"` so the spawned process IS the
// nginx master (not a forked background daemon) — `this.#pid` is a real,
// signalable pid, and a plain `child.on('exit', ...)` actually fires when
// nginx goes away instead of firing immediately for a parent that forked
// and exited.
//
// Reload, not restart, for a config change while already running: SIGHUP
// to the nginx master is nginx's own documented graceful-reload mechanism
// (re-reads config, spins up new workers, lets old workers finish
// in-flight connections) — no need to kill/respawn something nginx
// already does better itself. Whether that reload cleanly repoints an
// already-live `push` target without interrupting it is still an open
// question (docs/TECHNICAL.md, build order step 8 settles it
// empirically) — this module reloads either way; what happens to an
// in-flight push is step 8's concern, not this one's.
//
// Constructor takes a single deps object, not a long positional list —
// same call as `HttpApi`'s own constructor, and for the same reason: this
// many fields (five required, four with defaults for testability) reads
// worse as positional args than as named ones.
//
// Deps object also carries `spawnFn` and `exitFn`, both defaulted to the
// real `node:child_process.spawn`/`process.exit` — injected specifically
// so unit tests can drive crash-loop logic (including the "give up and
// exit the sidecar" branch) with a fake child process and a fake exit
// function that just records the call, instead of either needing a real
// nginx binary or actually killing the test runner. Matches the build
// order's own description of this step: "core state-tracking logic unit-
// testable with a fake child_process; actually starting/reloading needs
// the real binary."
//
// EventBus listeners here are async (re-rendering reads two
// repositories), but `EventBus.emit()`'s own try/catch only guards a
// listener's *synchronous* throw — a rejection after the listener's first
// `await` would otherwise become an unhandled rejection and take the
// whole process down with it, defeating the EventBus's own isolation
// guarantee. Each subscription below is therefore a synchronous wrapper
// around an async handler with its own `.catch()`, logged through this
// module's own logger rather than rethrown.

import { type ChildProcess, spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import type { EventBus } from "../../infra/event-bus.ts";
import type { Logger } from "../../infra/logger.ts";
import type { DestinationProfileRepository } from "../profiles/profiles.repository.ts";
import { DEFAULT_TEMPLATE, renderNginxConfig } from "./nginx-config-renderer.ts";
import type { RelayStateRepository } from "./relay.repository.ts";

const CRASH_WINDOW_MS = 60_000;
// "3 times within 60s" (docs/TECHNICAL.md) means the 3rd crash in the
// window is the one that gives up — not the 4th. Two restarts get
// attempted; the crash that would be the third restart instead exits the
// sidecar and lets Docker's own `restart: unless-stopped` take over.
const MAX_CRASHES_IN_WINDOW = 3;

interface NginxProcessManagerDeps {
  logger: Logger;
  eventBus: EventBus;
  destinationProfiles: DestinationProfileRepository;
  relayState: RelayStateRepository;
  httpPort: number;
  nginxBinary?: string;
  configPath?: string;
  spawnFn?: typeof spawn;
  exitFn?: (code: number) => void;
}

export class NginxProcessManager {
  readonly #logger: Logger;
  readonly #eventBus: EventBus;
  readonly #destinationProfiles: DestinationProfileRepository;
  readonly #relayState: RelayStateRepository;
  readonly #httpPort: number;
  readonly #nginxBinary: string;
  readonly #configPath: string;
  readonly #spawnFn: typeof spawn;
  readonly #exitFn: (code: number) => void;

  #child: ChildProcess | undefined;
  #pid: number | undefined;
  #running = false;
  #stopping = false;
  #lastExitCode: number | null = null;
  #lastCrashError: string | undefined;
  #crashTimestamps: number[] = [];

  constructor(deps: NginxProcessManagerDeps) {
    this.#logger = deps.logger;
    this.#eventBus = deps.eventBus;
    this.#destinationProfiles = deps.destinationProfiles;
    this.#relayState = deps.relayState;
    this.#httpPort = deps.httpPort;
    this.#nginxBinary = deps.nginxBinary ?? "nginx";
    this.#configPath = deps.configPath ?? "/tmp/nginx.conf";
    this.#spawnFn = deps.spawnFn ?? spawn;
    this.#exitFn = deps.exitFn ?? ((code) => process.exit(code));
  }

  async init(): Promise<void> {
    this.#eventBus.on("ActiveProfileChanged", (payload) => {
      this.#handleActiveProfileChanged(payload.userId).catch((err) =>
        this.#logAsyncHandlerError(err, "ActiveProfileChanged"),
      );
    });
    this.#eventBus.on("DestinationCredentialsUpdated", (payload) => {
      this.#handleDestinationCredentialsUpdated(payload.userId).catch((err) =>
        this.#logAsyncHandlerError(err, "DestinationCredentialsUpdated"),
      );
    });

    // Restart case, not fresh install: a profile was already active before
    // this process started, so render + start immediately rather than
    // waiting for an ActiveProfileChanged that will never come again.
    const activeUserId = await this.#relayState.getActiveUserId();
    if (activeUserId) {
      await this.#renderAndApply(activeUserId);
    }
  }

  // dispose() — gracefully stop the nginx process by sending SIGTERM to the
  // master process. nginx's standard handler for SIGTERM is to stop accepting
  // new connections and wait for in-flight connections to close. Safe to call
  // multiple times (idempotent — if nginx isn't running, returns immediately).
  // Called during shutdown (SIGTERM handler in bootstrap).
  dispose(): void {
    if (!this.#child) return;
    this.#stopping = true;
    this.#child.kill("SIGTERM");
  }

  isRunning(): boolean {
    return this.#running;
  }

  getPid(): number | undefined {
    return this.#pid;
  }

  getLastExitCode(): number | null {
    return this.#lastExitCode;
  }

  getLastCrashError(): string | undefined {
    return this.#lastCrashError;
  }

  async #handleActiveProfileChanged(userId: string): Promise<void> {
    await this.#renderAndApply(userId);
  }

  async #handleDestinationCredentialsUpdated(userId: string): Promise<void> {
    // Only re-render if the edited profile is the one actually live —
    // editing a profile that isn't active persists to Mongo but doesn't
    // touch nginx (docs/TECHNICAL.md, Event taxonomy, User events).
    const activeUserId = await this.#relayState.getActiveUserId();
    if (activeUserId !== userId) return;
    await this.#renderAndApply(userId);
  }

  async #renderAndApply(userId: string): Promise<void> {
    const profile = await this.#destinationProfiles.get(userId);
    if (!profile) {
      // RelayStateRepository points at a profile that no longer exists —
      // shouldn't happen (UsersService.deleteUser() blocks deleting the
      // active broadcaster), but if it ever does, this is corrupted state
      // worth logging loudly rather than crashing nginx over.
      this.#logger.error(
        { userId },
        "NginxProcessManager: active profile not found, skipping render",
      );
      return;
    }

    const rendered = renderNginxConfig(DEFAULT_TEMPLATE, profile, this.#httpPort);
    await writeFile(this.#configPath, rendered, "utf8");

    if (this.#running) {
      this.#reload();
    } else {
      this.#spawnNginx();
    }
  }

  #spawnNginx(): void {
    this.#stopping = false;
    const child = this.#spawnFn(this.#nginxBinary, ["-c", this.#configPath, "-g", "daemon off;"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.#wireChild(child);
  }

  #reload(): void {
    if (!this.#child) {
      this.#spawnNginx();
      return;
    }
    this.#child.kill("SIGHUP");
  }

  #wireChild(child: ChildProcess): void {
    this.#child = child;
    this.#pid = child.pid;
    this.#running = true;

    // Required local try/catch, not covered by EventBus's own isolation —
    // these are listeners on Node's ChildProcess emitter, which we didn't
    // write, same category as MongoService's driver-event listeners (see
    // docs/TECHNICAL.md §Error handling, rule 2).
    child.on("exit", (code, signal) => {
      try {
        this.#running = false;
        this.#lastExitCode = code;
        const at = new Date();

        if (this.#stopping) {
          this.#eventBus.emit("nginx.exited", { code, at });
          this.#stopping = false;
          return;
        }

        const error = `nginx exited unexpectedly (code=${code}, signal=${signal ?? "none"})`;
        this.#lastCrashError = error;
        this.#eventBus.emit("nginx.crashed", { error, at });
        this.#handleCrash();
      } catch (err) {
        this.#logger.error(
          { err: err instanceof Error ? err.message : err },
          "NginxProcessManager: exit handler threw",
        );
      }
    });

    child.on("error", (err) => {
      try {
        this.#running = false;
        const error = err instanceof Error ? err.message : String(err);
        this.#lastCrashError = error;
        this.#eventBus.emit("nginx.crashed", { error, at: new Date() });
        this.#handleCrash();
      } catch (handlerErr) {
        this.#logger.error(
          { err: handlerErr instanceof Error ? handlerErr.message : handlerErr },
          "NginxProcessManager: error handler threw",
        );
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      this.#logger.warn({ nginx: chunk.toString().trim() }, "nginx stderr");
    });

    this.#eventBus.emit("nginx.started", { at: new Date() });
  }

  #handleCrash(): void {
    const now = Date.now();
    this.#crashTimestamps = this.#crashTimestamps.filter((t) => now - t < CRASH_WINDOW_MS);
    this.#crashTimestamps.push(now);

    if (this.#crashTimestamps.length >= MAX_CRASHES_IN_WINDOW) {
      this.#logger.fatal(
        { crashes: this.#crashTimestamps.length, windowMs: CRASH_WINDOW_MS },
        "NginxProcessManager: too many crashes in window, exiting sidecar",
      );
      this.#exitFn(1);
      return;
    }

    this.#logger.warn(
      { lastCrashError: this.#lastCrashError, crashesInWindow: this.#crashTimestamps.length },
      "NginxProcessManager: restarting nginx after crash",
    );
    this.#spawnNginx();
  }

  #logAsyncHandlerError(err: unknown, event: string): void {
    this.#logger.error(
      { event, err: err instanceof Error ? err.message : err },
      "NginxProcessManager: async event handler failed",
    );
  }
}
