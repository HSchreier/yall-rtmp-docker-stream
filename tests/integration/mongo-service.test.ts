import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Logger } from "../../src/infra/logger.ts";
import { MongoService } from "../../src/infra/mongo-service.ts";

// Requires a live MongoDB reachable at MONGO_TEST_URI. Not part of the
// no-external-services unit tier — see docs/TECHNICAL.md §Testing strategy,
// "Integration tests". Run with a throwaway container:
//   docker run -d -p 27117:27017 mongo:7
const uri = process.env.MONGO_TEST_URI ?? "mongodb://localhost:27117/mongoservice-test";

describe("MongoService (integration — requires live Mongo)", () => {
  let service: MongoService;

  beforeAll(async () => {
    service = new MongoService(new Logger(), uri);
    await service.init();
  });

  afterAll(async () => {
    await service.close();
  });

  test("isConnected() becomes true after init(), driven by real heartbeat events", async () => {
    // init() awaits connect(), but the heartbeat event that flips
    // isConnected() lands asynchronously right after — give it a moment
    // rather than assuming it's instant.
    await Bun.sleep(300);
    expect(service.isConnected()).toBe(true);
    expect(service.getLastConnectedAt()).toBeInstanceOf(Date);
  });

  test("db() returns a Db that can actually read and write", async () => {
    const collection = service.db().collection("integration-smoke");
    const insert = await collection.insertOne({ probe: true });
    const found = await collection.findOne({ _id: insert.insertedId });
    expect(found?.probe).toBe(true);
  });
});
