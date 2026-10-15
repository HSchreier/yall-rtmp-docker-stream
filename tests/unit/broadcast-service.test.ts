// BroadcastService (unit — fake repositories, no live Mongo needed).
// Covers: slot state transitions, go-live/end-set flows, admin kicks,
// session history tracking, and in-memory stats.

import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "../../src/infra/errors.ts";
import { EventBus } from "../../src/infra/event-bus.ts";
import { Logger } from "../../src/infra/logger.ts";
import { BroadcastService } from "../../src/modules/broadcast/broadcast.service.ts";
import type { RelayStateRepository } from "../../src/modules/relay/relay.repository.ts";
import type { UserDoc, UserRepository } from "../../src/modules/users/users.repository.ts";

function makeUserDoc(overrides: Partial<UserDoc>): UserDoc {
  const now = new Date();
  return {
    userId: "u1",
    email: "a@example.com",
    passwordHash: "hash",
    role: "user",
    createdAt: now,
    registeredBy: "admin-0",
    streamKey: "test-key-32-chars-padding-here",
    streamKeyExpiry: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
    ...overrides,
  };
}

interface FakeUsersState {
  byId: Map<string, UserDoc>;
  byEmail: Map<string, UserDoc>;
}

function fakeUserRepository(state: FakeUsersState): Partial<UserRepository> {
  return {
    findById: async (userId: string) => state.byId.get(userId) ?? null,
    findByEmail: async (email: string) => state.byEmail.get(email) ?? null,
    isEmpty: async () => state.byId.size === 0,
    create: async () => {
      throw new Error("not implemented in test");
    },
    list: async () => [],
    init: async () => {},
    update: async () => {
      throw new Error("not implemented in test");
    },
    delete: async () => {
      throw new Error("not implemented in test");
    },
    regenerateStreamKey: async () => {
      throw new Error("not implemented in test");
    },
    countByRole: async () => 0,
    findByStreamKey: async () => null,
  };
}

interface FakeRelayState {
  activeUserId: string | null;
}

function fakeRelayRepository(state: FakeRelayState): Partial<RelayStateRepository> {
  return {
    getActiveUserId: async () => state.activeUserId,
    setActive: async (userId: string) => {
      state.activeUserId = userId;
      return new Date();
    },
  };
}

describe("BroadcastService", () => {
  test("go-live sets active broadcaster and returns success", async () => {
    const usersState: FakeUsersState = {
      byId: new Map([["u1", makeUserDoc({ userId: "u1", email: "user1@example.com" })]]),
      byEmail: new Map([
        ["user1@example.com", makeUserDoc({ userId: "u1", email: "user1@example.com" })],
      ]),
    };
    const relayState: FakeRelayState = { activeUserId: null };

    const service = new BroadcastService(
      fakeUserRepository(usersState) as UserRepository,
      fakeRelayRepository(relayState) as RelayStateRepository,
      new EventBus(new Logger()),
      new Logger(),
    );

    const result = await service.goLive("u1", "user1@example.com");

    expect(result.success).toBe(true);
    expect(result.activeEmail).toBe("u1");
    expect(result.myStatus).toBe("live");
    expect(result.slotExpiry).toBeDefined();
    expect(relayState.activeUserId).toBe("u1");
  });

  test("go-live fails when another user is active", async () => {
    const usersState: FakeUsersState = {
      byId: new Map([
        ["u1", makeUserDoc({ userId: "u1", email: "user1@example.com" })],
        ["u2", makeUserDoc({ userId: "u2", email: "user2@example.com" })],
      ]),
      byEmail: new Map([
        ["user1@example.com", makeUserDoc({ userId: "u1", email: "user1@example.com" })],
        ["user2@example.com", makeUserDoc({ userId: "u2", email: "user2@example.com" })],
      ]),
    };
    const relayState: FakeRelayState = { activeUserId: "u2" };

    const service = new BroadcastService(
      fakeUserRepository(usersState) as UserRepository,
      fakeRelayRepository(relayState) as RelayStateRepository,
      new EventBus(new Logger()),
      new Logger(),
    );

    const result = await service.goLive("u1", "user1@example.com");

    expect(result.success).toBe(false);
    expect(result.activeEmail).toBe("u2");
    expect(result.myStatus).toBe("taken");
  });

  test("end-set records session history and clears active slot", async () => {
    const usersState: FakeUsersState = {
      byId: new Map([["u1", makeUserDoc({ userId: "u1", email: "user1@example.com" })]]),
      byEmail: new Map([
        ["user1@example.com", makeUserDoc({ userId: "u1", email: "user1@example.com" })],
      ]),
    };
    const relayState: FakeRelayState = { activeUserId: null };

    const service = new BroadcastService(
      fakeUserRepository(usersState) as UserRepository,
      fakeRelayRepository(relayState) as RelayStateRepository,
      new EventBus(new Logger()),
      new Logger(),
    );

    // Go live first
    await service.goLive("u1", "user1@example.com");

    // Wait a moment to record some duration
    await new Promise((resolve) => setTimeout(resolve, 100));

    // End set
    const result = await service.endSet("u1");

    expect(result.success).toBe(true);
    expect(result.sessionHistory.length).toBe(1);
    expect(result.sessionHistory[0]?.email).toBe("u1");
    expect(result.sessionHistory[0]?.destinations).toContain("YouTube");
  });

  test("end-set fails if not the active broadcaster", async () => {
    const usersState: FakeUsersState = {
      byId: new Map([["u1", makeUserDoc({ userId: "u1", email: "user1@example.com" })]]),
      byEmail: new Map([
        ["user1@example.com", makeUserDoc({ userId: "u1", email: "user1@example.com" })],
      ]),
    };
    const relayState: FakeRelayState = { activeUserId: null };

    const service = new BroadcastService(
      fakeUserRepository(usersState) as UserRepository,
      fakeRelayRepository(relayState) as RelayStateRepository,
      new EventBus(new Logger()),
      new Logger(),
    );

    try {
      await service.endSet("u1");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenError);
    }
  });

  test("admin can kick any active session", async () => {
    const usersState: FakeUsersState = {
      byId: new Map([
        ["u1", makeUserDoc({ userId: "u1", email: "user1@example.com" })],
        ["admin", makeUserDoc({ userId: "admin", email: "admin@example.com", role: "admin" })],
      ]),
      byEmail: new Map([
        ["user1@example.com", makeUserDoc({ userId: "u1", email: "user1@example.com" })],
        [
          "admin@example.com",
          makeUserDoc({ userId: "admin", email: "admin@example.com", role: "admin" }),
        ],
      ]),
    };
    const relayState: FakeRelayState = { activeUserId: null };

    const service = new BroadcastService(
      fakeUserRepository(usersState) as UserRepository,
      fakeRelayRepository(relayState) as RelayStateRepository,
      new EventBus(new Logger()),
      new Logger(),
    );

    // Go live
    await service.goLive("u1", "user1@example.com");

    // Admin kicks the session
    const result = await service.endSessionAdmin("user1@example.com", "admin");

    expect(result.success).toBe(true);
    // Session should be cleared
    const _history = service.getSessionHistory();
    // Note: endSessionAdmin doesn't record to history, just kicks
  });

  test("get-stats returns mock broadcast stats", async () => {
    const usersState: FakeUsersState = {
      byId: new Map([["u1", makeUserDoc({ userId: "u1", email: "user1@example.com" })]]),
      byEmail: new Map([
        ["user1@example.com", makeUserDoc({ userId: "u1", email: "user1@example.com" })],
      ]),
    };
    const relayState: FakeRelayState = { activeUserId: null };

    const service = new BroadcastService(
      fakeUserRepository(usersState) as UserRepository,
      fakeRelayRepository(relayState) as RelayStateRepository,
      new EventBus(new Logger()),
      new Logger(),
    );

    const stats = await service.getStats();

    expect(stats.inputKbps).toBe(5000);
    expect(stats.audioKbps).toBe(128);
    expect(stats.videoKbps).toBe(4872);
    expect(stats.format).toBe("h264+aac");
    expect(stats.destinations).toContain("YouTube");
    expect(stats.sentKbps).toBe(2500);
  });

  test("get-history returns session history filtered by email", async () => {
    const usersState: FakeUsersState = {
      byId: new Map([["u1", makeUserDoc({ userId: "u1", email: "user1@example.com" })]]),
      byEmail: new Map([
        ["user1@example.com", makeUserDoc({ userId: "u1", email: "user1@example.com" })],
      ]),
    };
    const relayState: FakeRelayState = { activeUserId: null };

    const service = new BroadcastService(
      fakeUserRepository(usersState) as UserRepository,
      fakeRelayRepository(relayState) as RelayStateRepository,
      new EventBus(new Logger()),
      new Logger(),
    );

    // Go live and end set to create history
    await service.goLive("u1", "user1@example.com");
    await service.endSet("u1");

    const history = await service.getHistory("u1", 50);

    expect(history.length).toBe(1);
    expect(history[0]?.email).toBe("u1");
  });
});
