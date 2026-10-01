// IngestEventReceiver (unit — fake repositories, no live Mongo or nginx
// needed). Covers: the whole authorization check (no active profile, a
// stream key that doesn't match the active profile) and the
// StreamStarted/StreamEnded events it emits, including that
// durationMs is actually measured, not fabricated.

import { describe, expect, test } from "bun:test";
import { ForbiddenError } from "../../src/infra/errors.ts";
import { EventBus } from "../../src/infra/event-bus.ts";
import type { StreamEnded, StreamStarted } from "../../src/infra/events.ts";
import { Logger } from "../../src/infra/logger.ts";
import type {
  DestinationProfileDoc,
  DestinationProfileRepository,
} from "../../src/modules/profiles/profiles.repository.ts";
import { IngestEventReceiver } from "../../src/modules/relay/ingest-event-receiver.ts";
import type { RelayStateRepository } from "../../src/modules/relay/relay.repository.ts";

function makeProfile(overrides: Partial<DestinationProfileDoc> = {}): DestinationProfileDoc {
  return {
    userId: "u1",
    ingestStreamKey: "correct-key",
    mixcloud: { enabled: false },
    youtube: { enabled: false },
    twitch: { enabled: false },
    bufferProfile: "mobile",
    updatedAt: new Date(),
    updatedBy: "u1",
    ...overrides,
  };
}

function fakeProfileRepository(
  profile: DestinationProfileDoc | null,
): DestinationProfileRepository {
  return {
    get: async (userId: string) => (profile && profile.userId === userId ? profile : null),
  } as unknown as DestinationProfileRepository;
}

function fakeRelayRepository(activeUserId: string | null): RelayStateRepository {
  return {
    getActiveUserId: async () => activeUserId,
  } as unknown as RelayStateRepository;
}

describe("IngestEventReceiver.handlePublish", () => {
  test("rejects when no profile is active", async () => {
    const receiver = new IngestEventReceiver(
      fakeProfileRepository(null),
      fakeRelayRepository(null),
      new EventBus(new Logger()),
    );

    await expect(receiver.handlePublish("correct-key")).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("rejects a stream key that doesn't match the active profile's", async () => {
    const receiver = new IngestEventReceiver(
      fakeProfileRepository(makeProfile()),
      fakeRelayRepository("u1"),
      new EventBus(new Logger()),
    );

    await expect(receiver.handlePublish("wrong-key")).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("emits StreamStarted for a matching stream key", async () => {
    const eventBus = new EventBus(new Logger());
    const received: StreamStarted[] = [];
    eventBus.on("StreamStarted", (payload) => received.push(payload));

    const receiver = new IngestEventReceiver(
      fakeProfileRepository(makeProfile()),
      fakeRelayRepository("u1"),
      eventBus,
    );

    await receiver.handlePublish("correct-key");

    expect(received).toHaveLength(1);
    expect(received[0]?.streamKey).toBe("correct-key");
  });
});

describe("IngestEventReceiver.handlePublishDone", () => {
  test("emits StreamEnded with durationMs measured from the prior handlePublish call", async () => {
    const eventBus = new EventBus(new Logger());
    const received: StreamEnded[] = [];
    eventBus.on("StreamEnded", (payload) => received.push(payload));

    const receiver = new IngestEventReceiver(
      fakeProfileRepository(makeProfile()),
      fakeRelayRepository("u1"),
      eventBus,
    );

    await receiver.handlePublish("correct-key");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await receiver.handlePublishDone("correct-key");

    expect(received).toHaveLength(1);
    expect(received[0]?.streamKey).toBe("correct-key");
    expect(received[0]?.durationMs).toBeGreaterThan(0);
    // totalBytesIn has no real source yet (see the module's own header
    // comment) — asserting it's the explicit, flagged 0, not silently
    // becoming some other placeholder value later.
    expect(received[0]?.totalBytesIn).toBe(0);
  });

  test("durationMs is 0 when no matching handlePublish ever ran", async () => {
    const eventBus = new EventBus(new Logger());
    const received: StreamEnded[] = [];
    eventBus.on("StreamEnded", (payload) => received.push(payload));

    const receiver = new IngestEventReceiver(
      fakeProfileRepository(makeProfile()),
      fakeRelayRepository("u1"),
      eventBus,
    );

    await receiver.handlePublishDone("correct-key");

    expect(received[0]?.durationMs).toBe(0);
  });
});
