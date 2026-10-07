// ProfileService — owns the "activate my own profile" orchestration that
// used to live inline in http-api.ts's /profile/activate handler. get()/
// upsert() pass straight through to the repository (no extra behavior to
// own yet), kept here rather than skipped so the router only ever talks to
// services, never reaches into a repository directly.

import { ValidationError } from "../../infra/errors.ts";
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
    // Validate YouTube credentials
    if (update.youtube?.enabled) {
      if (!update.youtube.streamKey?.trim()) {
        throw new ValidationError("YouTube: Stream key (RTMPS) is required.");
      }
      if (update.youtube.streamKey.length > 1000) {
        throw new ValidationError("YouTube: Stream key is too long (max 1000 chars).");
      }
    }

    // Validate Twitch credentials
    if (update.twitch?.enabled) {
      if (!update.twitch.streamKey?.trim()) {
        throw new ValidationError("Twitch: Stream key is required.");
      }
      if (update.twitch.streamKey.length > 1000) {
        throw new ValidationError("Twitch: Stream key is too long (max 1000 chars).");
      }
    }

    // Validate Mixcloud credentials
    if (update.mixcloud?.enabled) {
      if (!update.mixcloud.streamUrl?.trim()) {
        throw new ValidationError("Mixcloud: Stream URL (full RTMP endpoint) is required.");
      }
      if (
        !update.mixcloud.streamUrl.startsWith("rtmp://") &&
        !update.mixcloud.streamUrl.startsWith("rtmps://")
      ) {
        throw new ValidationError("Mixcloud: Stream URL must start with rtmp:// or rtmps://");
      }
      if (update.mixcloud.streamUrl.length > 2000) {
        throw new ValidationError("Mixcloud: Stream URL is too long (max 2000 chars).");
      }
    }

    return this.profiles.upsert(userId, update, updatedBy);
  }

  async activateOwn(userId: string): Promise<{ activeUserId: string; activatedAt: Date }> {
    const activatedAt = await this.relay.setActive(userId, userId);
    return { activeUserId: userId, activatedAt };
  }
}
