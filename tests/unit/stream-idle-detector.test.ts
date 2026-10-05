// StreamIdleDetector (unit — fake EventBus, no timers). Covers: idle
// detection after N ticks with no growth, StreamResumed when growth resumes,
// and that idle/resumed each fire exactly once (not per tick).

import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus.ts";
import { Logger } from "../../src/infra/logger.ts";
import { StreamIdleDetector } from "../../src/modules/relay/stream-idle-detector.ts";

describe("StreamIdleDetector", () => {
  test("emits StreamIdle after 3 ticks with no growth", async () => {
    const eventBus = new EventBus(new Logger());
    const detector = new StreamIdleDetector(eventBus, new Logger(), "key-1");
    detector.start();

    const idleEvents: Array<{ streamKey: string }> = [];
    eventBus.on("StreamIdle", (payload) => {
      idleEvents.push(payload);
    });

    // Tick 1: no growth (0 -> 0)
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 0,
      bitrateKbps: 0,
      at: new Date(),
    });
    expect(idleEvents.length).toBe(0);

    // Tick 2: still no growth
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 0,
      bitrateKbps: 0,
      at: new Date(),
    });
    expect(idleEvents.length).toBe(0);

    // Tick 3: still no growth — should trigger idle
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 0,
      bitrateKbps: 0,
      at: new Date(),
    });
    expect(idleEvents.length).toBe(1);
    expect(idleEvents[0]?.streamKey).toBe("key-1");

    detector.dispose();
  });

  test("does not emit StreamIdle again on subsequent no-growth ticks", async () => {
    const eventBus = new EventBus(new Logger());
    const detector = new StreamIdleDetector(eventBus, new Logger(), "key-1");
    detector.start();

    const idleEvents: Array<{ streamKey: string }> = [];
    eventBus.on("StreamIdle", (payload) => {
      idleEvents.push(payload);
    });

    // Emit 5 ticks with no growth
    for (let i = 0; i < 5; i++) {
      eventBus.emit("StreamStatUpdated", {
        streamKey: "key-1",
        bytesIn: 0,
        bitrateKbps: 0,
        at: new Date(),
      });
    }

    // Should emit idle exactly once (on tick 3), not 5 times
    expect(idleEvents.length).toBe(1);

    detector.dispose();
  });

  test("emits StreamResumed when bytesIn grows after idle", async () => {
    const eventBus = new EventBus(new Logger());
    const detector = new StreamIdleDetector(eventBus, new Logger(), "key-1");
    detector.start();

    const idleEvents: Array<{ streamKey: string }> = [];
    const resumedEvents: Array<{ streamKey: string }> = [];
    eventBus.on("StreamIdle", (payload) => {
      idleEvents.push(payload);
    });
    eventBus.on("StreamResumed", (payload) => {
      resumedEvents.push(payload);
    });

    // Trigger idle: 3 ticks with no growth
    for (let i = 0; i < 3; i++) {
      eventBus.emit("StreamStatUpdated", {
        streamKey: "key-1",
        bytesIn: 0,
        bitrateKbps: 0,
        at: new Date(),
      });
    }
    expect(idleEvents.length).toBe(1);
    expect(resumedEvents.length).toBe(0);

    // Resume: emit growth
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 10000,
      bitrateKbps: 500,
      at: new Date(),
    });
    expect(resumedEvents.length).toBe(1);
    expect(resumedEvents[0]?.streamKey).toBe("key-1");

    detector.dispose();
  });

  test("does not emit StreamResumed if not idle", async () => {
    const eventBus = new EventBus(new Logger());
    const detector = new StreamIdleDetector(eventBus, new Logger(), "key-1");
    detector.start();

    const resumedEvents: Array<{ streamKey: string }> = [];
    eventBus.on("StreamResumed", (payload) => {
      resumedEvents.push(payload);
    });

    // Stream live with continuous growth
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 100000,
      bitrateKbps: 1000,
      at: new Date(),
    });
    expect(resumedEvents.length).toBe(0);

    // More growth
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 200000,
      bitrateKbps: 1000,
      at: new Date(),
    });
    expect(resumedEvents.length).toBe(0); // No resumed since never went idle

    detector.dispose();
  });

  test("ignores events for other stream keys", async () => {
    const eventBus = new EventBus(new Logger());
    const detector = new StreamIdleDetector(eventBus, new Logger(), "key-1");
    detector.start();

    const idleEvents: Array<{ streamKey: string }> = [];
    eventBus.on("StreamIdle", (payload) => {
      idleEvents.push(payload);
    });

    // Emit ticks for a different stream key
    for (let i = 0; i < 5; i++) {
      eventBus.emit("StreamStatUpdated", {
        streamKey: "key-2",
        bytesIn: 0,
        bitrateKbps: 0,
        at: new Date(),
      });
    }

    // key-1's detector should not emit idle
    expect(idleEvents.length).toBe(0);

    detector.dispose();
  });

  test("resets idle counter on meaningful growth", async () => {
    const eventBus = new EventBus(new Logger());
    const detector = new StreamIdleDetector(eventBus, new Logger(), "key-1");
    detector.start();

    const idleEvents: Array<{ streamKey: string }> = [];
    eventBus.on("StreamIdle", (payload) => {
      idleEvents.push(payload);
    });

    // Tick 1: no growth
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 0,
      bitrateKbps: 0,
      at: new Date(),
    });

    // Tick 2: growth (reset counter)
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 50000,
      bitrateKbps: 500,
      at: new Date(),
    });

    // Tick 3: no growth again (counter at 1)
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 50000,
      bitrateKbps: 0,
      at: new Date(),
    });

    // Tick 4: no growth (counter at 2)
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 50000,
      bitrateKbps: 0,
      at: new Date(),
    });

    // Tick 5: no growth (counter at 3) — should trigger idle
    eventBus.emit("StreamStatUpdated", {
      streamKey: "key-1",
      bytesIn: 50000,
      bitrateKbps: 0,
      at: new Date(),
    });

    expect(idleEvents.length).toBe(1);

    detector.dispose();
  });
});
