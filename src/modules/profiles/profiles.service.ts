// ProfileService — owns the "activate my own profile" orchestration that
// used to live inline in http-api.ts's /profile/activate handler. get()/
// upsert() pass straight through to the repository (no extra behavior to
// own yet), kept here rather than skipped so the router only ever talks to
// services, never reaches into a repository directly.

import { ValidationError } from "../../infra/errors.ts";
import {
  RTMP_URL_RE,
  STREAM_KEY_FORMAT_PLATFORM_RE,
} from "../../infra/validators.ts";
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
      const key = update.youtube.streamKey?.trim();
      if (!key) {
        throw new ValidationError("YouTube: Stream key (RTMPS) is required.");
      }
      if (!STREAM_KEY_FORMAT_PLATFORM_RE.test(key)) {
        throw new ValidationError("YouTube: Stream key format invalid (alphanumeric/dash/underscore, 10-200 chars).");
      }
    }

    // Validate Twitch credentials
    if (update.twitch?.enabled) {
      const key = update.twitch.streamKey?.trim();
      if (!key) {
        throw new ValidationError("Twitch: Stream key is required.");
      }
      if (!STREAM_KEY_FORMAT_PLATFORM_RE.test(key)) {
        throw new ValidationError("Twitch: Stream key format invalid (alphanumeric/dash/underscore, 10-200 chars).");
      }
    }

    // Validate Mixcloud credentials
    if (update.mixcloud?.enabled) {
      const url = update.mixcloud.streamUrl?.trim();
      if (!url) {
        throw new ValidationError("Mixcloud: Stream URL (full RTMP endpoint) is required.");
      }
      if (!RTMP_URL_RE.test(url)) {
        throw new ValidationError(
          "Mixcloud: Stream URL must be valid RTMP/RTMPS URL (rtmp(s)://host[:port]/path).",
        );
      }
    }

    return this.profiles.upsert(userId, update, updatedBy);
  }

  async activateOwn(userId: string): Promise<{ activeUserId: string; activatedAt: Date }> {
    const activatedAt = await this.relay.setActive(userId, userId);
    return { activeUserId: userId, activatedAt };
  }
}
