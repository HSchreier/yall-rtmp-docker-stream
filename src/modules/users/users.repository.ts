// UserRepository — docs/TECHNICAL.md §Persistence & auth, `users` collection.
// One design decision made here that TECHNICAL.md left implicit: `userId`
// on the wire is the Mongo ObjectId's hex string, not a separately generated
// UUID. Stagebox's own convention (docs/SCHEMA_ASSOCIATIONS.md there) is a
// UUID decoupled from `_id` — but that's Stagebox's stated convention for
// its own project, never declared here, and a redundant UUID field adds a
// second unique index for no benefit on a collection this small. Flagging
// the choice, not hiding it.
//
// The bootstrap-registration race (docs/TECHNICAL.md open questions) is
// NOT fixed here — isEmpty() + insert isn't atomic by itself, and the real
// fix belongs where the race actually happens: AuthService, which will use
// a fixed-_id lock document (first insert on a constant _id wins,
// atomically) rather than anything indexable on this collection alone.

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
}

interface UserRow {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
  registeredBy: string | null;
}

function toDoc(row: UserRow): UserDoc {
  return {
    userId: row._id.toHexString(),
    email: row.email,
    passwordHash: row.passwordHash,
    role: row.role,
    createdAt: row.createdAt,
    registeredBy: row.registeredBy,
  };
}

export class UserRepository {
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
    return (rows as UserRow[]).map(toDoc);
  }

  async create(input: {
    email: string;
    passwordHash: string;
    role: Role;
    registeredBy: string | null;
  }): Promise<UserDoc> {
    const row: Omit<UserRow, "_id"> = {
      email: input.email,
      passwordHash: input.passwordHash,
      role: input.role,
      createdAt: new Date(),
      registeredBy: input.registeredBy,
    };
    const result = await this.#collection.insertOne(row);
    return toDoc({ ...row, _id: result.insertedId });
  }

  async countByRole(role: Role): Promise<number> {
    return this.#collection.countDocuments({ role });
  }

  async update(
    userId: string,
    patch: { email?: string; role?: Role; passwordHash?: string },
  ): Promise<UserDoc | null> {
    if (!ObjectId.isValid(userId)) return null;
    const result = await this.#collection.findOneAndUpdate(
      { _id: new ObjectId(userId) } as never,
      { $set: patch },
      { returnDocument: "after" },
    );
    return result ? toDoc(result as UserRow) : null;
  }

  async delete(userId: string): Promise<boolean> {
    if (!ObjectId.isValid(userId)) return false;
    const result = await this.#collection.deleteOne({ _id: new ObjectId(userId) } as never);
    return result.deletedCount > 0;
  }
}
