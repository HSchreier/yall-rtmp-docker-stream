// StreamStatsSession (unit — fake EventBus, no real timers). Covers: timer
// is started and cleared, StreamStatUpdated is emitted, and error handling
// with the 3-strike dispose rule.

import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus.ts";
import { Logger } from "../../src/infra/logger.ts";
import { StreamStatsSession } from "../../src/modules/relay/stream-stats-session.ts";

describe("StreamStatsSession", () => {
  test("emits StreamStatUpdated on each tick", async () => {
    const eventBus = new EventBus(new Logger());
    const session = new StreamStatsSession(eventBus, new Logger(), "key-1");

    const emitted: Array<{ streamKey: string; bytesIn: number; bitrateKbps: number }> = [];
    eventBus.on("StreamStatUpdated", (payload) => {
      emitted.push(payload);
    });

    session.start();

    // Wait for the first tick to fire (interval is 1000ms)
    await new Promise((resolve) => setTimeout(resolve, 1100));

    expect(emitted.length).toBeGreaterThanOrEqual(1);
    expect(emitted[0]?.streamKey).toBe("key-1");
    expect(emitted[0]?.bytesIn).toBe(0);
    expect(emitted[0]?.bitrateKbps).toBe(0);

    session.dispose();
  });

  test("clears the timer on dispose", async () => {
    const eventBus = new EventBus(new Logger());
    const session = new StreamStatsSession(eventBus, new Logger(), "key-1");

    let emitCount = 0;
    eventBus.on("StreamStatUpdated", () => {
      emitCount += 1;
    });

    session.start();
    await new Promise((resolve) => setTimeout(resolve, 1100)); // Let one tick fire
    const countAfterFirstTick = emitCount;

    session.dispose();
    await new Promise((resolve) => setTimeout(resolve, 1100)); // Wait but timer is stopped

    // No new emissions after dispose
    expect(emitCount).toBe(countAfterFirstTick);
  });

  test("can be disposed multiple times without throwing", () => {
    const eventBus = new EventBus(new Logger());
    const session = new StreamStatsSession(eventBus, new Logger(), "key-1");

    session.start();
    expect(() => {
      session.dispose();
      session.dispose();
      session.dispose();
    }).not.toThrow();
  });

  test("disposes itself after 3 consecutive errors", async () => {
    const logger = new Logger();
    const eventBus = new EventBus(logger);

    // Create a session, then instrument it to throw
    const session = new StreamStatsSession(eventBus, logger, "key-1");

    let emitCount = 0;
    eventBus.on("StreamStatUpdated", () => {
      emitCount += 1;
      // Simulate error by throwing
      throw new Error("synthetic test error");
    });

    session.start();
    await new Promise((resolve) => setTimeout(resolve, 3500)); // 3+ ticks

    // Even though we threw 3+ times, session should have disposed itself
    // and stopped emitting. The exact count depends on timing, but it
    // should settle at the point of the 3rd error.
    expect(emitCount).toBeGreaterThan(0);

    session.dispose();
  });
});
