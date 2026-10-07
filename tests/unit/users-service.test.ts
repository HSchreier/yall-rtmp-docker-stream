// UsersService (unit — fake repositories, no live Mongo needed). Covers the
// cross-collection safety rules that are the actual point of this service:
// can't strand the app with zero admins, can't delete the account nginx is
// (or will be) actively relaying for, cascades a profile delete, and keeps
// email uniqueness on update the same as registration does.

import { describe, expect, test } from "bun:test";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../src/infra/errors.ts";
import { EventBus } from "../../src/infra/event-bus.ts";
import type { UserRemoved, UserUpdated } from "../../src/infra/events.ts";
import { Logger } from "../../src/infra/logger.ts";
import type { JwtPayload } from "../../src/modules/auth/auth.service.ts";
import type { DestinationProfileRepository } from "../../src/modules/profiles/profiles.repository.ts";
import type { RelayStateRepository } from "../../src/modules/relay/relay.repository.ts";
import type { UserDoc, UserRepository } from "../../src/modules/users/users.repository.ts";
import { UsersService } from "../../src/modules/users/users.service.ts";

function admin(userId: string): JwtPayload {
  return { userId, role: "admin" };
}
function asUser(userId: string): JwtPayload {
  return { userId, role: "user" };
}

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
}

function fakeUserRepository(state: FakeUsersState): UserRepository {
  return {
    findById: async (userId: string) => state.byId.get(userId) ?? null,
    findByEmail: async (email: string) =>
      [...state.byId.values()].find((u) => u.email === email) ?? null,
    countByRole: async (role: string) =>
      [...state.byId.values()].filter((u) => u.role === role).length,
    update: async (userId: string, patch: Partial<UserDoc>) => {
      const existing = state.byId.get(userId);
      if (!existing) return null;
      const updated = { ...existing, ...patch };
      state.byId.set(userId, updated);
      return updated;
    },
    delete: async (userId: string) => state.byId.delete(userId),
  } as unknown as UserRepository;
}

function fakeProfileRepository(deleted: string[]): DestinationProfileRepository {
  return {
    exists: async () => false,
    delete: async (userId: string) => {
      deleted.push(userId);
    },
  } as unknown as DestinationProfileRepository;
}

function fakeRelayRepository(activeUserId: string | null): RelayStateRepository {
  return {
    getActiveUserId: async () => activeUserId,
  } as unknown as RelayStateRepository;
}

describe("UsersService.updateUser", () => {
  test("rejects demoting the last remaining admin", async () => {
    const state: FakeUsersState = {
      byId: new Map([["admin-1", makeUserDoc({ userId: "admin-1", role: "admin" })]]),
    };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    await expect(
      service.updateUser("admin-1", { role: "user" }, admin("admin-1")),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("allows demoting an admin when another admin still exists", async () => {
    const state: FakeUsersState = {
      byId: new Map([
        ["admin-1", makeUserDoc({ userId: "admin-1", role: "admin" })],
        ["admin-2", makeUserDoc({ userId: "admin-2", email: "b@example.com", role: "admin" })],
      ]),
    };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    const result = await service.updateUser("admin-1", { role: "user" }, admin("admin-2"));
    expect(result.role).toBe("user");
  });

  test("rejects an email already used by a different account", async () => {
    const state: FakeUsersState = {
      byId: new Map([
        ["u1", makeUserDoc({ userId: "u1", email: "taken@example.com" })],
        ["u2", makeUserDoc({ userId: "u2", email: "free@example.com" })],
      ]),
    };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    await expect(
      service.updateUser("u2", { email: "taken@example.com" }, admin("admin-1")),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  test("rejects an empty patch", async () => {
    const state: FakeUsersState = { byId: new Map([["u1", makeUserDoc({})]]) };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    await expect(service.updateUser("u1", {}, admin("admin-1"))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  test("emits UserUpdated with the changed field names, not the values", async () => {
    const state: FakeUsersState = { byId: new Map([["u1", makeUserDoc({})]]) };
    const eventBus = new EventBus(new Logger());
    const received: UserUpdated[] = [];
    eventBus.on("UserUpdated", (payload) => received.push(payload));

    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      eventBus,
    );

    await service.updateUser("u1", { email: "new@example.com" }, admin("admin-1"));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      userId: "u1",
      changedFields: ["email"],
      updatedBy: "admin-1",
    });
  });

  test("404s on a userId that doesn't exist", async () => {
    const state: FakeUsersState = { byId: new Map() };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    await expect(
      service.updateUser("ghost", { role: "admin" }, admin("admin-1")),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  test("a user can edit their own email/password (self-service)", async () => {
    const state: FakeUsersState = { byId: new Map([["u1", makeUserDoc({ userId: "u1" })]]) };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    const result = await service.updateUser(
      "u1",
      { email: "new@example.com", password: "a-new-long-password" },
      asUser("u1"),
    );
    expect(result.email).toBe("new@example.com");
  });

  test("a user cannot edit another account", async () => {
    const state: FakeUsersState = {
      byId: new Map([
        ["u1", makeUserDoc({ userId: "u1" })],
        ["u2", makeUserDoc({ userId: "u2", email: "other@example.com" })],
      ]),
    };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    await expect(
      service.updateUser("u2", { email: "hijacked@example.com" }, asUser("u1")),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("a user cannot change their own role, even to the same value", async () => {
    const state: FakeUsersState = { byId: new Map([["u1", makeUserDoc({ userId: "u1" })]]) };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    await expect(service.updateUser("u1", { role: "admin" }, asUser("u1"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});

describe("UsersService.deleteUser", () => {
  test("rejects deleting the last remaining admin", async () => {
    const state: FakeUsersState = {
      byId: new Map([["admin-1", makeUserDoc({ userId: "admin-1", role: "admin" })]]),
    };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    await expect(service.deleteUser("admin-1", "admin-1")).rejects.toBeInstanceOf(ConflictError);
  });

  test("rejects deleting the currently active broadcaster", async () => {
    const state: FakeUsersState = { byId: new Map([["u1", makeUserDoc({ userId: "u1" })]]) };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository("u1"),
      new EventBus(new Logger()),
    );

    await expect(service.deleteUser("u1", "admin-1")).rejects.toBeInstanceOf(ConflictError);
  });

  test("cascades to the destination profile and emits UserRemoved", async () => {
    const state: FakeUsersState = { byId: new Map([["u1", makeUserDoc({ userId: "u1" })]]) };
    const deletedProfiles: string[] = [];
    const eventBus = new EventBus(new Logger());
    const received: UserRemoved[] = [];
    eventBus.on("UserRemoved", (payload) => received.push(payload));

    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository(deletedProfiles),
      fakeRelayRepository(null),
      eventBus,
    );

    await service.deleteUser("u1", "admin-1");

    expect(state.byId.has("u1")).toBe(false);
    expect(deletedProfiles).toEqual(["u1"]);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ userId: "u1", removedBy: "admin-1" });
  });

  test("404s on a userId that doesn't exist", async () => {
    const state: FakeUsersState = { byId: new Map() };
    const service = new UsersService(
      fakeUserRepository(state),
      fakeProfileRepository([]),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    await expect(service.deleteUser("ghost", "admin-1")).rejects.toBeInstanceOf(NotFoundError);
  });
});
