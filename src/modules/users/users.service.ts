// UsersService — owns the orchestration that used to live inline in
// http-api.ts's /users handler: stitching UserRepository + ProfileRepository
// + RelayRepository together into a view the dashboard can render, admin-
// initiated activation, and (below) admin editing/removal of an account —
// including the safety checks that span more than one collection, which is
// exactly the kind of thing that must not be scattered across routers or
// repositories. The router's job is only to translate HTTP <-> these
// methods; it makes no decisions of its own about what "active" or
// "hasProfile" mean, or when a mutation is actually safe to allow.
//
// updateUser() is also the self-service "my account" path (see Settings
// §My account) — a user-role caller editing their own userId is allowed
// through, same ownership pattern as /profile, but can never include
// `role` in that patch, even on themselves: letting a non-admin touch
// `role` at all, even their own, is a privilege-escalation path, not a
// convenience.

import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../infra/errors.ts";
import type { EventBus } from "../../infra/event-bus.ts";
import type { Role } from "../../infra/events.ts";
import { EMAIL_RE, MIN_PASSWORD_LENGTH } from "../../infra/validators.ts";
import type { JwtPayload } from "../auth/auth.service.ts";
import type { DestinationProfileRepository } from "../profiles/profiles.repository.ts";
import type { RelayStateRepository } from "../relay/relay.repository.ts";
import type { UserRepository } from "./users.repository.ts";

export interface UserListEntry {
  userId: string;
  email: string;
  role: string;
  hasProfile: boolean;
  isActive: boolean;
}

export interface UserPatch {
  email?: string;
  role?: Role;
  password?: string;
}

export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly profiles: DestinationProfileRepository,
    private readonly relay: RelayStateRepository,
    private readonly eventBus: EventBus,
  ) {}

  async getSelf(userId: string): Promise<UserListEntry> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError("User not found.");

    const [hasProfile, activeUserId] = await Promise.all([
      this.profiles.exists(userId),
      this.relay.getActiveUserId(),
    ]);

    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      hasProfile,
      isActive: user.userId === activeUserId,
    };
  }

  async createUser(
    input: { email: string; password: string; role?: string },
    createdBy: string,
  ): Promise<UserListEntry> {
    if (!EMAIL_RE.test(input.email)) {
      throw new ValidationError("Enter a valid email address.");
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const existing = await this.users.findByEmail(input.email);
    if (existing) {
      throw new ConflictError("An account with that email already exists.");
    }

    const role = (input.role === "admin" ? "admin" : "user") as Role;
    const passwordHash = await Bun.password.hash(input.password);
    const user = await this.users.create({
      email: input.email,
      passwordHash,
      role,
      registeredBy: createdBy,
    });

    this.eventBus.emit("UserRegistered", {
      userId: user.userId,
      email: user.email,
      role: user.role,
      registeredBy: createdBy,
      at: new Date(),
    });

    const [hasProfile, activeUserId] = await Promise.all([
      this.profiles.exists(user.userId),
      this.relay.getActiveUserId(),
    ]);

    return {
      userId: user.userId,
      email: user.email,
      role: user.role,
      hasProfile,
      isActive: user.userId === activeUserId,
    };
  }

  async listWithStatus(): Promise<UserListEntry[]> {
    const [users, activeUserId] = await Promise.all([
      this.users.list(),
      this.relay.getActiveUserId(),
    ]);

    return Promise.all(
      users.map(async (u) => ({
        userId: u.userId,
        email: u.email,
        role: u.role,
        // passwordHash deliberately excluded — same _id-leak lesson as
        // ProfileRepository.get(): never return the whole stored document
        // just because it was convenient to.
        hasProfile: await this.profiles.exists(u.userId),
        isActive: u.userId === activeUserId,
      })),
    );
  }

  async activateFor(
    targetUserId: string,
    activatedBy: string,
  ): Promise<{ activeUserId: string; activatedAt: Date }> {
    const activatedAt = await this.relay.setActive(targetUserId, activatedBy);
    return { activeUserId: targetUserId, activatedAt };
  }

  async updateUser(
    targetUserId: string,
    patch: UserPatch,
    actingUser: JwtPayload,
  ): Promise<UserListEntry> {
    const isSelf = actingUser.userId === targetUserId;
    if (!isSelf && actingUser.role !== "admin") {
      throw new ForbiddenError("Admin role required to edit another account.");
    }
    if (patch.role !== undefined && actingUser.role !== "admin") {
      throw new ForbiddenError("Admin role required to change a role — including your own.");
    }

    const target = await this.users.findById(targetUserId);
    if (!target) throw new NotFoundError("No such user.");

    const changedFields: Array<"email" | "role" | "password"> = [];
    const repoPatch: { email?: string; role?: Role; passwordHash?: string } = {};

    if (patch.email !== undefined) {
      if (!EMAIL_RE.test(patch.email)) {
        throw new ValidationError("Enter a valid email address.");
      }
      const existing = await this.users.findByEmail(patch.email);
      if (existing && existing.userId !== targetUserId) {
        throw new ConflictError("An account with that email already exists.");
      }
      repoPatch.email = patch.email;
      changedFields.push("email");
    }

    if (patch.role !== undefined) {
      if (patch.role !== "user" && patch.role !== "admin") {
        throw new ValidationError('role must be "user" or "admin".');
      }
      if (target.role === "admin" && patch.role === "user") {
        const adminCount = await this.users.countByRole("admin");
        if (adminCount <= 1) {
          throw new ConflictError(
            "Can't demote the last remaining admin — promote another account first.",
          );
        }
      }
      repoPatch.role = patch.role;
      changedFields.push("role");
    }

    if (patch.password !== undefined) {
      if (patch.password.length < MIN_PASSWORD_LENGTH) {
        throw new ValidationError(`Password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
      }
      repoPatch.passwordHash = await Bun.password.hash(patch.password);
      changedFields.push("password");
    }

    if (changedFields.length === 0) {
      throw new ValidationError("Nothing to update — provide email, role, and/or password.");
    }

    const updated = await this.users.update(targetUserId, repoPatch);
    if (!updated) throw new NotFoundError("No such user.");

    this.eventBus.emit("UserUpdated", {
      userId: targetUserId,
      changedFields,
      updatedBy: actingUser.userId,
      at: new Date(),
    });

    const [hasProfile, activeUserId] = await Promise.all([
      this.profiles.exists(targetUserId),
      this.relay.getActiveUserId(),
    ]);
    return {
      userId: updated.userId,
      email: updated.email,
      role: updated.role,
      hasProfile,
      isActive: updated.userId === activeUserId,
    };
  }

  async deleteUser(targetUserId: string, removedBy: string): Promise<void> {
    const target = await this.users.findById(targetUserId);
    if (!target) throw new NotFoundError("No such user.");

    if (target.role === "admin") {
      const adminCount = await this.users.countByRole("admin");
      if (adminCount <= 1) {
        throw new ConflictError(
          "Can't delete the last remaining admin — promote another account first.",
        );
      }
    }

    const activeUserId = await this.relay.getActiveUserId();
    if (activeUserId === targetUserId) {
      throw new ConflictError(
        "This user is the currently active broadcaster — activate someone else (or deactivate) before deleting them.",
      );
    }

    // Cascade: an orphaned destination_profiles document (still holding a
    // real, working ingestStreamKey) for a deleted account is dangling
    // data with no owner to consent to its continued existence.
    await this.profiles.delete(targetUserId);
    await this.users.delete(targetUserId);

    this.eventBus.emit("UserRemoved", { userId: targetUserId, removedBy, at: new Date() });
  }

  async getStreamKey(userId: string): Promise<{ streamKey: string; expiresAt: Date }> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundError("User not found.");
    return {
      streamKey: user.streamKey,
      expiresAt: user.streamKeyExpiry,
    };
  }

  async regenerateStreamKey(
    userId: string,
    regeneratedBy: string,
  ): Promise<{ streamKey: string; expiresAt: Date }> {
    const user = await this.users.regenerateStreamKey(userId);
    if (!user) throw new NotFoundError("User not found.");

    this.eventBus.emit("UserUpdated", {
      userId,
      changedFields: ["email"],
      updatedBy: regeneratedBy,
      at: new Date(),
    });

    return {
      streamKey: user.streamKey,
      expiresAt: user.streamKeyExpiry,
    };
  }
}
