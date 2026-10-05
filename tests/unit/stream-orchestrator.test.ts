// StreamOrchestrator (unit — fake EventBus + fake submodule factories,
// no timers or real submodules). Covers: factories are called on
// StreamStarted, .start() is called on each, .dispose() is called on both
// StreamEnded and nginx.crashed, and double-dispose doesn't throw or
// double-fire cleanup.

import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus.ts";
import { Logger } from "../../src/infra/logger.ts";
import {
  StreamOrchestrator,
  type StreamSubmodule,
  type StreamSubmoduleFactory,
} from "../../src/modules/relay/stream-orchestrator.ts";

class FakeSubmodule implements StreamSubmodule {
  startCalls = 0;
  disposeCalls = 0;

  start(): void {
    this.startCalls += 1;
  }

  dispose(): void {
    this.disposeCalls += 1;
  }
}

class FakeSubmoduleFactory {
  callCount = 0;
  createdSubmodules: FakeSubmodule[] = [];

  factory: StreamSubmoduleFactory = (_eventBus, _logger, _streamKey) => {
    const submodule = new FakeSubmodule();
    this.createdSubmodules.push(submodule);
    this.callCount += 1;
    return submodule;
  };
}

describe("StreamOrchestrator", () => {
  test("calls all factories on StreamStarted", async () => {
    const eventBus = new EventBus(new Logger());
    const factory1 = new FakeSubmoduleFactory();
    const factory2 = new FakeSubmoduleFactory();
    const orchestrator = new StreamOrchestrator(eventBus, new Logger(), [
      factory1.factory,
      factory2.factory,
    ]);
    await orchestrator.init();

    eventBus.emit("StreamStarted", {
      streamKey: "key-1",
      at: new Date(),
    });

    expect(factory1.callCount).toBe(1);
    expect(factory2.callCount).toBe(1);
  });

  test("calls .start() on each created submodule", async () => {
    const eventBus = new EventBus(new Logger());
    const factory1 = new FakeSubmoduleFactory();
    const factory2 = new FakeSubmoduleFactory();
    const orchestrator = new StreamOrchestrator(eventBus, new Logger(), [
      factory1.factory,
      factory2.factory,
    ]);
    await orchestrator.init();

    eventBus.emit("StreamStarted", {
      streamKey: "key-1",
      at: new Date(),
    });

    expect(factory1.createdSubmodules[0]?.startCalls).toBe(1);
    expect(factory2.createdSubmodules[0]?.startCalls).toBe(1);
  });

  test("calls .dispose() on all submodules on StreamEnded", async () => {
    const eventBus = new EventBus(new Logger());
    const factory1 = new FakeSubmoduleFactory();
    const factory2 = new FakeSubmoduleFactory();
    const orchestrator = new StreamOrchestrator(eventBus, new Logger(), [
      factory1.factory,
      factory2.factory,
    ]);
    await orchestrator.init();

    eventBus.emit("StreamStarted", {
      streamKey: "key-1",
      at: new Date(),
    });
    expect(factory1.createdSubmodules[0]?.disposeCalls).toBe(0);
    expect(factory2.createdSubmodules[0]?.disposeCalls).toBe(0);

    eventBus.emit("StreamEnded", {
      streamKey: "key-1",
      at: new Date(),
      durationMs: 10000,
      totalBytesIn: 5000000,
    });

    expect(factory1.createdSubmodules[0]?.disposeCalls).toBe(1);
    expect(factory2.createdSubmodules[0]?.disposeCalls).toBe(1);
  });

  test("calls .dispose() on all submodules on nginx.crashed", async () => {
    const eventBus = new EventBus(new Logger());
    const factory1 = new FakeSubmoduleFactory();
    const factory2 = new FakeSubmoduleFactory();
    const orchestrator = new StreamOrchestrator(eventBus, new Logger(), [
      factory1.factory,
      factory2.factory,
    ]);
    await orchestrator.init();

    eventBus.emit("StreamStarted", {
      streamKey: "key-1",
      at: new Date(),
    });
    expect(factory1.createdSubmodules[0]?.disposeCalls).toBe(0);

    eventBus.emit("nginx.crashed", {
      error: "nginx exited unexpectedly",
      at: new Date(),
    });

    expect(factory1.createdSubmodules[0]?.disposeCalls).toBe(1);
    expect(factory2.createdSubmodules[0]?.disposeCalls).toBe(1);
  });

  test("calling .dispose() twice (both StreamEnded and nginx.crashed in a race) doesn't throw", async () => {
    const eventBus = new EventBus(new Logger());
    const factory = new FakeSubmoduleFactory();
    const orchestrator = new StreamOrchestrator(eventBus, new Logger(), [factory.factory]);
    await orchestrator.init();

    eventBus.emit("StreamStarted", {
      streamKey: "key-1",
      at: new Date(),
    });

    // Emit both events — nginx.crashed clears all, then StreamEnded tries to
    // dispose the same submodule again (but it's no longer tracked).
    eventBus.emit("nginx.crashed", {
      error: "test crash",
      at: new Date(),
    });

    // This should not throw even though the submodule was already disposed.
    eventBus.emit("StreamEnded", {
      streamKey: "key-1",
      at: new Date(),
      durationMs: 10000,
      totalBytesIn: 0,
    });

    // dispose() should have been called exactly once (by nginx.crashed).
    expect(factory.createdSubmodules[0]?.disposeCalls).toBe(1);
  });

  test("manages multiple concurrent streams independently", async () => {
    const eventBus = new EventBus(new Logger());
    const factory1 = new FakeSubmoduleFactory();
    const factory2 = new FakeSubmoduleFactory();
    const orchestrator = new StreamOrchestrator(eventBus, new Logger(), [
      factory1.factory,
      factory2.factory,
    ]);
    await orchestrator.init();

    // Start two streams
    eventBus.emit("StreamStarted", {
      streamKey: "key-1",
      at: new Date(),
    });
    eventBus.emit("StreamStarted", {
      streamKey: "key-2",
      at: new Date(),
    });

    expect(factory1.callCount).toBe(2);
    expect(factory2.callCount).toBe(2);

    // End one stream — only its submodules are disposed
    eventBus.emit("StreamEnded", {
      streamKey: "key-1",
      at: new Date(),
      durationMs: 10000,
      totalBytesIn: 0,
    });

    expect(factory1.createdSubmodules[0]?.disposeCalls).toBe(1); // key-1's submodule
    expect(factory1.createdSubmodules[1]?.disposeCalls).toBe(0); // key-2's submodule still live
    expect(factory2.createdSubmodules[0]?.disposeCalls).toBe(1);
    expect(factory2.createdSubmodules[1]?.disposeCalls).toBe(0);
  });
});
