import { describe, expect, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus.ts";
import { Logger } from "../../src/infra/logger.ts";

describe("EventBus", () => {
  test("delivers a payload to a listener", () => {
    const bus = new EventBus(new Logger());
    let received: { at: Date } | undefined;
    bus.on("nginx.started", (payload) => {
      received = payload;
    });

    const at = new Date();
    bus.emit("nginx.started", { at });

    expect(received).toEqual({ at });
  });

  test("a listener throwing does not stop sibling listeners for the same event", () => {
    const bus = new EventBus(new Logger());
    let secondListenerRan = false;

    bus.on("nginx.crashed", () => {
      throw new Error("boom");
    });
    bus.on("nginx.crashed", () => {
      secondListenerRan = true;
    });

    // Should not throw out of emit() — the whole point of centralizing the
    // try/catch is that a bad listener can't crash the process or block
    // others.
    expect(() => bus.emit("nginx.crashed", { error: "boom", at: new Date() })).not.toThrow();
    expect(secondListenerRan).toBe(true);
  });

  test("a listener throwing does not propagate out of emit()", () => {
    const bus = new EventBus(new Logger());
    bus.on("nginx.exited", () => {
      throw new Error("should be caught internally");
    });

    expect(() => bus.emit("nginx.exited", { code: 1, at: new Date() })).not.toThrow();
  });
});
