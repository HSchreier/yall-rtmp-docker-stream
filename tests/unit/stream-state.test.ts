// StreamState (unit — fake EventBus, no live Mongo or nginx needed).
// Covers: the full status lifecycle (offline→live→idle→resumed→offline),
// state transitions driven by events, null values when offline, and stats
// updates via StreamStatUpdated.

import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus.ts";
import { Logger } from "../../src/infra/logger.ts";
import { StreamState } from "../../src/modules/relay/stream-state.ts";

describe("StreamState", () => {
  test("starts offline with all state null", async () => {
    const streamState = new StreamState(new EventBus(new Logger()));
    await streamState.init();

    expect(streamState.getStatus()).toBe("offline");
    expect(streamState.getStreamKey()).toBe(null);
    expect(streamState.getBytesIn()).toBe(0);
    expect(streamState.getBitrateKbps()).toBe(0);
    expect(streamState.getStartedAt()).toBe(null);
    expect(streamState.getLastEventAt()).toBe(null);
  });

  test("transitions to live on StreamStarted", async () => {
    const eventBus = new EventBus(new Logger());
    const streamState = new StreamState(eventBus);
    await streamState.init();

    const now = new Date();
    eventBus.emit("StreamStarted", {
      streamKey: "test-key-123",
      at: now,
    });

    expect(streamState.getStatus()).toBe("live");
    expect(streamState.getStreamKey()).toBe("test-key-123");
    expect(streamState.getStartedAt()).toEqual(now);
    expect(streamState.getLastEventAt()).toEqual(now);
    expect(streamState.getBytesIn()).toBe(0);
    expect(streamState.getBitrateKbps()).toBe(0);
  });

  test("transitions to offline on StreamEnded", async () => {
    const eventBus = new EventBus(new Logger());
    const streamState = new StreamState(eventBus);
    await streamState.init();

    const startTime = new Date(Date.now() - 10000);
    const endTime = new Date();

    eventBus.emit("StreamStarted", {
      streamKey: "test-key-123",
      at: startTime,
    });
    expect(streamState.getStatus()).toBe("live");

    eventBus.emit("StreamEnded", {
      streamKey: "test-key-123",
      at: endTime,
      durationMs: 10000,
      totalBytesIn: 5000000,
    });

    expect(streamState.getStatus()).toBe("offline");
    expect(streamState.getStreamKey()).toBe(null);
    expect(streamState.getStartedAt()).toBe(null);
    expect(streamState.getBytesIn()).toBe(0);
    expect(streamState.getBitrateKbps()).toBe(0);
    expect(streamState.getLastEventAt()).toEqual(endTime);
  });

  test("transitions to idle on StreamIdle", async () => {
    const eventBus = new EventBus(new Logger());
    const streamState = new StreamState(eventBus);
    await streamState.init();

    const startTime = new Date(Date.now() - 10000);
    const idleTime = new Date();

    eventBus.emit("StreamStarted", {
      streamKey: "test-key-123",
      at: startTime,
    });
    expect(streamState.getStatus()).toBe("live");

    eventBus.emit("StreamIdle", {
      streamKey: "test-key-123",
      since: idleTime,
      at: idleTime,
    });

    expect(streamState.getStatus()).toBe("idle");
    expect(streamState.getStreamKey()).toBe("test-key-123");
    expect(streamState.getStartedAt()).toEqual(startTime);
    expect(streamState.getLastEventAt()).toEqual(idleTime);
  });

  test("transitions back to live on StreamResumed", async () => {
    const eventBus = new EventBus(new Logger());
    const streamState = new StreamState(eventBus);
    await streamState.init();

    const startTime = new Date(Date.now() - 20000);
    const idleTime = new Date(Date.now() - 10000);
    const resumeTime = new Date();

    eventBus.emit("StreamStarted", {
      streamKey: "test-key-123",
      at: startTime,
    });
    eventBus.emit("StreamIdle", {
      streamKey: "test-key-123",
      since: idleTime,
      at: idleTime,
    });
    expect(streamState.getStatus()).toBe("idle");

    eventBus.emit("StreamResumed", {
      streamKey: "test-key-123",
      at: resumeTime,
    });

    expect(streamState.getStatus()).toBe("live");
    expect(streamState.getStreamKey()).toBe("test-key-123");
    expect(streamState.getStartedAt()).toEqual(startTime);
    expect(streamState.getLastEventAt()).toEqual(resumeTime);
  });

  test("updates bytes and bitrate on StreamStatUpdated", async () => {
    const eventBus = new EventBus(new Logger());
    const streamState = new StreamState(eventBus);
    await streamState.init();

    const startTime = new Date(Date.now() - 10000);
    eventBus.emit("StreamStarted", {
      streamKey: "test-key-123",
      at: startTime,
    });

    const statTime1 = new Date(Date.now() - 5000);
    eventBus.emit("StreamStatUpdated", {
      streamKey: "test-key-123",
      bytesIn: 5000000,
      bitrateKbps: 4000,
      at: statTime1,
    });

    expect(streamState.getBytesIn()).toBe(5000000);
    expect(streamState.getBitrateKbps()).toBe(4000);
    expect(streamState.getLastEventAt()).toEqual(statTime1);

    const statTime2 = new Date();
    eventBus.emit("StreamStatUpdated", {
      streamKey: "test-key-123",
      bytesIn: 7500000,
      bitrateKbps: 5000,
      at: statTime2,
    });

    expect(streamState.getBytesIn()).toBe(7500000);
    expect(streamState.getBitrateKbps()).toBe(5000);
    expect(streamState.getLastEventAt()).toEqual(statTime2);
    // Status and startedAt should not change
    expect(streamState.getStatus()).toBe("live");
    expect(streamState.getStartedAt()).toEqual(startTime);
  });

  test("full lifecycle: start → stat updates → idle → resume → end", async () => {
    const eventBus = new EventBus(new Logger());
    const streamState = new StreamState(eventBus);
    await streamState.init();

    const t0 = new Date(Date.now() - 30000);
    const t1 = new Date(Date.now() - 20000);
    const t2 = new Date(Date.now() - 15000);
    const t3 = new Date(Date.now() - 10000);
    const t4 = new Date(Date.now() - 5000);
    const t5 = new Date();

    // Start
    eventBus.emit("StreamStarted", { streamKey: "key-1", at: t0 });
    expect(streamState.getStatus()).toBe("live");
    expect(streamState.getStreamKey()).toBe("key-1");

    // Stats
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 1000000,
      bitrateKbps: 2000,
      at: t1,
    });
    expect(streamState.getBytesIn()).toBe(1000000);

    // More stats
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 3000000,
      bitrateKbps: 3500,
      at: t2,
    });
    expect(streamState.getBytesIn()).toBe(3000000);

    // Idle
    eventBus.emit("StreamIdle", {
      streamKey: "key-1",
      since: t3,
      at: t3,
    });
    expect(streamState.getStatus()).toBe("idle");

    // Resume
    eventBus.emit("StreamResumed", { streamKey: "key-1", at: t4 });
    expect(streamState.getStatus()).toBe("live");

    // End
    eventBus.emit("StreamEnded", {
      streamKey: "key-1",
      at: t5,
      durationMs: 30000,
      totalBytesIn: 5000000,
    });
    expect(streamState.getStatus()).toBe("offline");
    expect(streamState.getStreamKey()).toBe(null);
    expect(streamState.getBytesIn()).toBe(0);
    expect(streamState.getLastEventAt()).toEqual(t5);
  });
});
