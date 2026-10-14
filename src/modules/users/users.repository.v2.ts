// Users Repository v2 — Normalized schema. Auth data only.
// No embedded profiles. Joins handled via aggregation pipelines.

import type { Collection, Db } from "mongodb";
import { ObjectId } from "mongodb";
import type { Role } from "../../infra/events.ts";

export interface UserDoc {
  userId: string;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
  registeredBy: string | null;
  streamKey: string;
  streamKeyExpiry: Date;
}

interface UserRow {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
  registeredBy: string | null;
  streamKey: string;
  streamKeyExpiry: Date;
}

function toDoc(row: UserRow): UserDoc {
  return {
    userId: row._id.toHexString(),
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    createdAt: row.createdAt,
    registeredBy: row.registeredBy,
    streamKey: row.streamKey,
    streamKeyExpiry: row.streamKeyExpiry,
  };
}

export class UserRepositoryV2 {
  readonly #collection: Collection<Omit<UserRow, "_id">>;

  constructor(db: Db) {
    this.#collection = db.collection<Omit<UserRow, "_id">>("users");
  }

  async init(): Promise<void> {
    await this.#collection.createIndex({ email: 1 }, { unique: true });
  }

  async isEmpty(): Promise<boolean> {
    const count = await this.#collection.countDocuments({}, { limit: 1 });
    return count === 0;
  }

  async findByEmail(email: string): Promise<UserDoc | null> {
    const row = await this.#collection.findOne({ email });
    return row ? toDoc(row as UserRow) : null;
  }

  async findById(userId: string): Promise<UserDoc | null> {
    if (!ObjectId.isValid(userId)) return null;
    const row = await this.#collection.findOne({ _id: new ObjectId(userId) } as never);
    return row ? toDoc(row as UserRow) : null;
  }

  async list(): Promise<UserDoc[]> {
    const rows = await this.#collection.find({}).sort({ createdAt: 1 }).toArray();
    return rows.map(toDoc);
  }

  async create(input: {
    email: string;
    passwordHash: string;
    role: Role;
    registeredBy: string | null;
  }): Promise<UserDoc> {
    const now = new Date();
    const expiry = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days
    const row: Omit<UserRow, "_id"> = {
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      createdAt: now,
      registeredBy: input.registeredBy,
      streamKey: Array.from(crypto.getRandomValues(new Uint8Array(32)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      streamKeyExpiry: expiry,
    };
    const result = await this.#collection.insertOne(row);
    return toDoc({ _id: result.insertedId as ObjectId, ...row });
  }

  async delete(userId: string): Promise<boolean> {
    if (!ObjectId.isValid(userId)) return false;
    const result = await this.#collection.deleteOne({ _id: new ObjectId(userId) });
    return result.deletedCount > 0;
  }
}
