import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus.ts";
import type { DestinationCredentialsUpdated } from "../../src/infra/events.ts";
import { Logger } from "../../src/infra/logger.ts";
import { MongoService } from "../../src/infra/mongo-service.ts";
import { DestinationProfileRepository } from "../../src/modules/profiles/profiles.repository.ts";

const uri =
  process.env.MONGO_TEST_URI ?? "mongodb://localhost:27117/destination-profile-repository-test";

describe("DestinationProfileRepository (integration — requires live Mongo)", () => {
  let mongo: MongoService;
  let eventBus: EventBus;
  let repo: DestinationProfileRepository;

  beforeAll(async () => {
    const logger = new Logger();
    mongo = new MongoService(logger, uri);
    await mongo.init();
    eventBus = new EventBus(logger);
    repo = new DestinationProfileRepository(mongo.db(), eventBus);
    await repo.init();
  });

  afterAll(async () => {
    await mongo.close();
  });

  beforeEach(async () => {
    await mongo.db().collection("destination_profiles").deleteMany({});
  });

  test("first upsert generates an ingestStreamKey; a second upsert keeps the same one", async () => {
    const first = await repo.upsert(
      "user-1",
      { mixcloud: { enabled: true, streamKey: "key-1" } },
      "user-1",
    );
    expect(first.ingestStreamKey).toMatch(/^[0-9a-f]{48}$/);

    const second = await repo.upsert(
      "user-1",
      { youtube: { enabled: true, streamKey: "yt-key" } },
      "user-1",
    );
    expect(second.ingestStreamKey).toBe(first.ingestStreamKey);
    // Partial update on youtube shouldn't have touched mixcloud.
    expect(second.mixcloud).toEqual({ enabled: true, streamKey: "key-1" });
  });

  test("emits DestinationCredentialsUpdated once per destination touched in the update", async () => {
    const received: DestinationCredentialsUpdated[] = [];
    eventBus.on("DestinationCredentialsUpdated", (payload) => received.push(payload));

    await repo.upsert(
      "user-2",
      {
        mixcloud: { enabled: true, streamKey: "a" },
        twitch: { enabled: true, streamKey: "b" },
      },
      "user-2",
    );

    expect(received).toHaveLength(2);
    expect(received.map((e) => e.destination).sort()).toEqual(["mixcloud", "twitch"]);
    expect(received.every((e) => e.userId === "user-2")).toBe(true);
  });

  test("exists()/get() reflect presence correctly", async () => {
    expect(await repo.exists("user-3")).toBe(false);
    expect(await repo.get("user-3")).toBeNull();

    await repo.upsert("user-3", { twitch: { enabled: true, streamKey: "x" } }, "user-3");

    expect(await repo.exists("user-3")).toBe(true);
    expect((await repo.get("user-3"))?.twitch.streamKey).toBe("x");
  });

  test("a disabled destination with no key stays that way through upsert defaults", async () => {
    const doc = await repo.upsert(
      "user-4",
      { mixcloud: { enabled: true, streamKey: "only-this-one" } },
      "user-4",
    );
    expect(doc.youtube).toEqual({ enabled: false });
    expect(doc.twitch).toEqual({ enabled: false });
  });
});
