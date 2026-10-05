// NginxProcessManager (unit — fake repositories + a fake child_process, no
// real nginx or Docker needed). Covers: starts on init() only when a
// profile is already active (the restart case), ActiveProfileChanged
// starts when not running / reloads (SIGHUP) when already running, a
// DestinationCredentialsUpdated for a non-active profile is a no-op, an
// unexpected exit emits nginx.crashed and restarts, a deliberate stop()
// emits nginx.exited instead and does not restart, and the crash-loop
// limit gives up (calls the injected exit function) on the 3rd crash
// within the window rather than attempting a 4th restart.

import { afterEach, describe, expect, test } from "bun:test";
import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { unlink } from "node:fs/promises";
import { EventBus } from "../../src/infra/event-bus.ts";
import type { NginxCrashed, NginxExited, NginxStarted } from "../../src/infra/events.ts";
import { Logger } from "../../src/infra/logger.ts";
import type {
  DestinationProfileDoc,
  DestinationProfileRepository,
} from "../../src/modules/profiles/profiles.repository.ts";
import { NginxProcessManager } from "../../src/modules/relay/nginx-process-manager.ts";
import type { RelayStateRepository } from "../../src/modules/relay/relay.repository.ts";

class FakeChildProcess extends EventEmitter {
  pid = 4242;
  readonly killSignals: string[] = [];
  stdout = undefined;
  stderr = undefined;
  kill(signal?: string | number): boolean {
    this.killSignals.push(String(signal ?? "SIGTERM"));
    return true;
  }
}

function makeProfile(overrides: Partial<DestinationProfileDoc> = {}): DestinationProfileDoc {
  return {
    userId: "u1",
    ingestStreamKey: "key",
    mixcloud: { enabled: false },
    youtube: { enabled: false },
    twitch: { enabled: false },
    bufferProfile: "mobile",
    updatedAt: new Date(),
    updatedBy: "u1",
    ...overrides,
  };
}

function fakeProfileRepository(
  profile: DestinationProfileDoc | null,
): DestinationProfileRepository {
  return {
    get: async (userId: string) => (profile && profile.userId === userId ? profile : null),
  } as unknown as DestinationProfileRepository;
}

function fakeRelayRepository(activeUserId: string | null): RelayStateRepository {
  return {
    getActiveUserId: async () => activeUserId,
  } as unknown as RelayStateRepository;
}

interface Harness {
  manager: NginxProcessManager;
  eventBus: EventBus;
  spawned: FakeChildProcess[];
  exitCalls: number[];
  configPath: string;
}

function makeHarness(opts: {
  activeUserId: string | null;
  profile: DestinationProfileDoc | null;
}): Harness {
  const eventBus = new EventBus(new Logger());
  const spawned: FakeChildProcess[] = [];
  const exitCalls: number[] = [];
  const configPath = `/tmp/nginx-process-manager-test-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.conf`;

  const spawnFn = ((..._args: unknown[]) => {
    const child = new FakeChildProcess();
    spawned.push(child);
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;

  const manager = new NginxProcessManager({
    logger: new Logger(),
    eventBus,
    destinationProfiles: fakeProfileRepository(opts.profile),
    relayState: fakeRelayRepository(opts.activeUserId),
    httpPort: 8080,
    configPath,
    spawnFn,
    exitFn: (code: number) => exitCalls.push(code),
  });

  return { manager, eventBus, spawned, exitCalls, configPath };
}

// Each async EventBus handler writes the rendered config to disk before
// spawning/reloading — a real await gap, not just a microtask — so tests
// that emit an event need to yield before asserting on its effect.
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

const cleanupPaths: string[] = [];
afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((p) => unlink(p).catch(() => {})));
});

describe("NginxProcessManager.init", () => {
  test("does nothing when no profile is active (fresh install)", async () => {
    const { manager, spawned } = makeHarness({ activeUserId: null, profile: null });
    await manager.init();
    expect(spawned).toHaveLength(0);
    expect(manager.isRunning()).toBe(false);
  });

  test("renders and starts nginx immediately when a profile is already active (restart case)", async () => {
    const h = makeHarness({ activeUserId: "u1", profile: makeProfile() });
    cleanupPaths.push(h.configPath);
    await h.manager.init();

    expect(h.spawned).toHaveLength(1);
    expect(h.manager.isRunning()).toBe(true);
    expect(h.manager.getPid()).toBe(4242);
  });

  test("emits nginx.started when nginx is spawned", async () => {
    const h = makeHarness({ activeUserId: "u1", profile: makeProfile() });
    cleanupPaths.push(h.configPath);
    const received: NginxStarted[] = [];
    h.eventBus.on("nginx.started", (p) => received.push(p));

    await h.manager.init();

    expect(received).toHaveLength(1);
  });
});

describe("NginxProcessManager — ActiveProfileChanged", () => {
  test("starts nginx on first activation when nothing was active before", async () => {
    const h = makeHarness({ activeUserId: null, profile: makeProfile() });
    cleanupPaths.push(h.configPath);
    await h.manager.init();
    expect(h.spawned).toHaveLength(0);

    h.eventBus.emit("ActiveProfileChanged", { userId: "u1", activatedBy: "u1", at: new Date() });
    await flush();

    expect(h.spawned).toHaveLength(1);
  });

  test("reloads (SIGHUP) instead of spawning again when nginx is already running", async () => {
    const h = makeHarness({ activeUserId: "u1", profile: makeProfile() });
    cleanupPaths.push(h.configPath);
    await h.manager.init();
    expect(h.spawned).toHaveLength(1);

    h.eventBus.emit("ActiveProfileChanged", { userId: "u1", activatedBy: "u1", at: new Date() });
    await flush();

    expect(h.spawned).toHaveLength(1);
    expect(h.spawned[0]?.killSignals).toEqual(["SIGHUP"]);
  });
});

describe("NginxProcessManager — DestinationCredentialsUpdated", () => {
  test("is a no-op for a profile that isn't currently active", async () => {
    const h = makeHarness({ activeUserId: "u1", profile: makeProfile() });
    cleanupPaths.push(h.configPath);
    await h.manager.init();
    expect(h.spawned).toHaveLength(1);

    h.eventBus.emit("DestinationCredentialsUpdated", {
      userId: "someone-else",
      destination: "twitch",
      at: new Date(),
    });
    await flush();

    expect(h.spawned[0]?.killSignals).toEqual([]);
  });

  test("reloads when the edited profile is the active one", async () => {
    const h = makeHarness({ activeUserId: "u1", profile: makeProfile() });
    cleanupPaths.push(h.configPath);
    await h.manager.init();

    h.eventBus.emit("DestinationCredentialsUpdated", {
      userId: "u1",
      destination: "twitch",
      at: new Date(),
    });
    await flush();

    expect(h.spawned[0]?.killSignals).toEqual(["SIGHUP"]);
  });
});

describe("NginxProcessManager — crash handling", () => {
  test("an unexpected exit emits nginx.crashed and restarts", async () => {
    const h = makeHarness({ activeUserId: "u1", profile: makeProfile() });
    cleanupPaths.push(h.configPath);
    const crashes: NginxCrashed[] = [];
    h.eventBus.on("nginx.crashed", (p) => crashes.push(p));

    await h.manager.init();
    expect(h.spawned).toHaveLength(1);

    h.spawned[0]?.emit("exit", 1, null);
    await flush();

    expect(crashes).toHaveLength(1);
    expect(h.spawned).toHaveLength(2);
    expect(h.manager.isRunning()).toBe(true);
    expect(h.manager.getLastExitCode()).toBe(1);
  });

  test("a deliberate stop() emits nginx.exited, not nginx.crashed, and does not restart", async () => {
    const h = makeHarness({ activeUserId: "u1", profile: makeProfile() });
    cleanupPaths.push(h.configPath);
    const exited: NginxExited[] = [];
    const crashes: NginxCrashed[] = [];
    h.eventBus.on("nginx.exited", (p) => exited.push(p));
    h.eventBus.on("nginx.crashed", (p) => crashes.push(p));

    await h.manager.init();
    h.manager.dispose();
    h.spawned[0]?.emit("exit", 0, null);
    await flush();

    expect(exited).toHaveLength(1);
    expect(crashes).toHaveLength(0);
    expect(h.spawned).toHaveLength(1);
    expect(h.manager.isRunning()).toBe(false);
  });

  test("gives up and calls the exit function on the 3rd crash within the window, instead of restarting again", async () => {
    const h = makeHarness({ activeUserId: "u1", profile: makeProfile() });
    cleanupPaths.push(h.configPath);

    await h.manager.init();
    expect(h.spawned).toHaveLength(1);

    h.spawned[0]?.emit("exit", 1, null);
    await flush();
    expect(h.spawned).toHaveLength(2);

    h.spawned[1]?.emit("exit", 1, null);
    await flush();
    expect(h.spawned).toHaveLength(3);

    h.spawned[2]?.emit("exit", 1, null);
    await flush();

    // Gave up instead of spawning a 4th time.
    expect(h.spawned).toHaveLength(3);
    expect(h.exitCalls).toEqual([1]);
  });
});
