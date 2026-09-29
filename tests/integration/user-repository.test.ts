import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { Logger } from "../../src/logger.ts";
import { MongoService } from "../../src/mongo-service.ts";
import { UserRepository } from "../../src/user-repository.ts";

const uri = process.env.MONGO_TEST_URI ?? "mongodb://localhost:27117/user-repository-test";

describe("UserRepository (integration — requires live Mongo)", () => {
  let mongo: MongoService;
  let repo: UserRepository;

  beforeAll(async () => {
    mongo = new MongoService(new Logger(), uri);
    await mongo.init();
    repo = new UserRepository(mongo.db());
    await repo.init();
  });

  afterAll(async () => {
    await mongo.close();
  });

  beforeEach(async () => {
    await mongo.db().collection("users").deleteMany({});
  });

  test("isEmpty() is true with no documents, false after one is created", async () => {
    expect(await repo.isEmpty()).toBe(true);
    await repo.create({
      email: "admin@example.com",
      passwordHash: "hash",
      role: "admin",
      registeredBy: null,
    });
    expect(await repo.isEmpty()).toBe(false);
  });

  test("create() returns a doc whose userId is the Mongo _id's hex string", async () => {
    const user = await repo.create({
      email: "a@example.com",
      passwordHash: "hash",
      role: "user",
      registeredBy: "admin-id",
    });
    expect(user.userId).toMatch(/^[0-9a-f]{24}$/);

    const found = await repo.findById(user.userId);
    expect(found?.email).toBe("a@example.com");
  });

  test("findByEmail() finds it, returns null for a non-existent email", async () => {
    await repo.create({
      email: "findme@example.com",
      passwordHash: "hash",
      role: "user",
      registeredBy: null,
    });
    expect((await repo.findByEmail("findme@example.com"))?.email).toBe("findme@example.com");
    expect(await repo.findByEmail("nobody@example.com")).toBeNull();
  });

  test("the unique index on email actually rejects a duplicate", async () => {
    await repo.create({
      email: "dupe@example.com",
      passwordHash: "hash",
      role: "user",
      registeredBy: null,
    });
    await expect(
      repo.create({
        email: "dupe@example.com",
        passwordHash: "hash2",
        role: "user",
        registeredBy: null,
      }),
    ).rejects.toThrow();
  });

  test("findById() returns null for a syntactically invalid id, not a driver error", async () => {
    expect(await repo.findById("not-an-object-id")).toBeNull();
  });
});
