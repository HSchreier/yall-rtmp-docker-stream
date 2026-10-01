// ProfileService — owns the "activate my own profile" orchestration that
// used to live inline in http-api.ts's /profile/activate handler. get()/
// upsert() pass straight through to the repository (no extra behavior to
// own yet), kept here rather than skipped so the router only ever talks to
// services, never reaches into a repository directly.

import type { RelayStateRepository } from "../relay/relay.repository.ts";
import type {
  DestinationProfileDoc,
  DestinationProfileRepository,
  DestinationProfileUpdate,
} from "./profiles.repository.ts";

export class ProfileService {
  constructor(
    private readonly profiles: DestinationProfileRepository,
    private readonly relay: RelayStateRepository,
  ) {}

  get(userId: string): Promise<DestinationProfileDoc | null> {
    return this.profiles.get(userId);
  }

  upsert(
    userId: string,
    update: DestinationProfileUpdate,
    updatedBy: string,
  ): Promise<DestinationProfileDoc> {
    return this.profiles.upsert(userId, update, updatedBy);
  }

  async activateOwn(userId: string): Promise<{ activeUserId: string; activatedAt: Date }> {
    const activatedAt = await this.relay.setActive(userId, userId);
    return { activeUserId: userId, activatedAt };
  }
}
