import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { EventBus } from "../../src/infra/event-bus.ts";
import type { ActiveProfileChanged } from "../../src/infra/events.ts";
import { Logger } from "../../src/infra/logger.ts";
import { MongoService } from "../../src/infra/mongo-service.ts";
import { RelayStateRepository } from "../../src/modules/relay/relay.repository.ts";

const uri = process.env.MONGO_TEST_URI ?? "mongodb://localhost:27117/relay-state-repository-test";

describe("RelayStateRepository (integration — requires live Mongo)", () => {
  let mongo: MongoService;
  let eventBus: EventBus;
  let repo: RelayStateRepository;

  beforeAll(async () => {
    const logger = new Logger();
    mongo = new MongoService(logger, uri);
    await mongo.init();
    eventBus = new EventBus(logger);
    repo = new RelayStateRepository(mongo.db(), eventBus);
  });

  afterAll(async () => {
    await mongo.dispose();
  });

  beforeEach(async () => {
    await mongo.db().collection("relay_state").deleteMany({});
  });

  test("getActiveUserId() is null before anything is ever activated", async () => {
    expect(await repo.getActiveUserId()).toBeNull();
  });

  test("setActive() upserts on a fixed _id — the document's _id is literally 'singleton', not an auto-generated ObjectId", async () => {
    await repo.setActive("user-1", "user-1");
    const raw = await mongo
      .db()
      .collection<{ _id: string; activeUserId: string }>("relay_state")
      .findOne({});
    expect(raw?._id).toBe("singleton");
    expect(await repo.getActiveUserId()).toBe("user-1");
  });

  test("setActive() again replaces the previous active user, doesn't create a second document", async () => {
    await repo.setActive("user-1", "user-1");
    await repo.setActive("user-2", "admin-1");

    expect(await repo.getActiveUserId()).toBe("user-2");
    expect(await mongo.db().collection("relay_state").countDocuments({})).toBe(1);
  });

  test("emits ActiveProfileChanged with the right userId/activatedBy", async () => {
    const received: ActiveProfileChanged[] = [];
    eventBus.on("ActiveProfileChanged", (payload) => received.push(payload));

    await repo.setActive("user-3", "admin-1");

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ userId: "user-3", activatedBy: "admin-1" });
  });
});
