// UsersService — owns the orchestration that used to live inline in
// http-api.ts's /users handler: stitching UserRepository + ProfileRepository
// + RelayRepository together into a view the dashboard can render, and
// carrying out an admin-initiated activation. The router's job is only to
// translate HTTP <-> these two methods; it makes no decisions of its own
// about what "active" or "hasProfile" mean.

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

export class UsersService {
  constructor(
    private readonly users: UserRepository,
    private readonly profiles: DestinationProfileRepository,
    private readonly relay: RelayStateRepository,
  ) {}

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
}
