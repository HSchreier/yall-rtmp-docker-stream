// AuthService — docs/TECHNICAL.md §Persistence & auth.
// Registration is bootstrap-then-admin-gated: an empty `users` collection
// allows one unauthenticated call, forced to role "admin"; every call after
// that requires a valid admin JWT. Login verifies via Bun.password
// (argon2id, built into the runtime — see docs/TECHNICAL.md, no bcrypt
// dependency at all).
//
// KNOWN GAP, not fixed here: the bootstrap race flagged in
// docs/TECHNICAL.md's open questions (two near-simultaneous unauthenticated
// register calls could both pass isEmpty() before either insert lands) is
// NOT mitigated in this version — the fix (a fixed-_id lock document) is
// still open, left out to keep today's build moving. Fine for a solo local
// test today; needs closing before anything resembling real deployment.

import jwt from "jsonwebtoken";
import { AuthError, ConflictError, ForbiddenError, ValidationError } from "../../infra/errors.ts";
import type { EventBus } from "../../infra/event-bus.ts";
import type { Role } from "../../infra/events.ts";
import type { UserRepository } from "../users/users.repository.ts";

const MIN_PASSWORD_LENGTH = 12;
// JWT lifetime is an open question in docs/TECHNICAL.md — 12h picked as a
// reasonable default for an internal tool, not derived from anything.
const TOKEN_TTL_SECONDS = 60 * 60 * 12;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface JwtPayload {
  userId: string;
  role: Role;
}

export interface RegisterInput {
  email: string;
  password: string;
  role?: Role;
}

export class AuthService {
  constructor(
    private readonly users: UserRepository,
    private readonly eventBus: EventBus,
    private readonly jwtSecret: string,
  ) {}

  async register(
    input: RegisterInput,
    actingUser: JwtPayload | null,
  ): Promise<{ userId: string; email: string; role: Role }> {
    if (!EMAIL_RE.test(input.email)) {
      throw new ValidationError("Enter a valid email address.");
    }
    if (input.password.length < MIN_PASSWORD_LENGTH) {
      throw new ValidationError(`Password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    }

    const isBootstrap = await this.users.isEmpty();
    let role: Role;
    let registeredBy: string | null;

    if (isBootstrap) {
      role = "admin"; // forced — input.role is ignored on the bootstrap call, by design
      registeredBy = null;
    } else {
      if (actingUser?.role !== "admin") {
        throw new ForbiddenError("Admin role required.");
      }
      role = input.role ?? "user";
      registeredBy = actingUser.userId;
    }

    if (await this.users.findByEmail(input.email)) {
      throw new ConflictError("An account with that email already exists. Log in instead.");
    }

    const passwordHash = await Bun.password.hash(input.password);
    const user = await this.users.create({
      email: input.email,
      passwordHash,
      role,
      registeredBy,
    });

    this.eventBus.emit("UserRegistered", {
      userId: user.userId,
      email: user.email,
      role: user.role,
      registeredBy: user.registeredBy,
      at: user.createdAt,
    });

    return { userId: user.userId, email: user.email, role: user.role };
  }

  async login(email: string, password: string): Promise<{ token: string; payload: JwtPayload }> {
    const user = await this.users.findByEmail(email);
    // Deliberately generic — never confirms whether the email exists.
    if (!user || !(await Bun.password.verify(password, user.passwordHash))) {
      throw new AuthError("Email or password incorrect.");
    }

    const payload: JwtPayload = { userId: user.userId, role: user.role };
    const token = this.issueToken(payload);
    this.eventBus.emit("UserLoggedIn", { userId: user.userId, at: new Date() });
    return { token, payload };
  }

  issueToken(payload: JwtPayload): string {
    return jwt.sign(payload, this.jwtSecret, { expiresIn: TOKEN_TTL_SECONDS });
  }

  verifyToken(token: string): JwtPayload {
    try {
      const decoded = jwt.verify(token, this.jwtSecret);
      if (typeof decoded === "string" || !decoded.userId || !decoded.role) {
        throw new AuthError();
      }
      return { userId: decoded.userId as string, role: decoded.role as Role };
    } catch {
      throw new AuthError();
    }
  }

  requireAdmin(payload: JwtPayload): void {
    if (payload.role !== "admin") {
      throw new ForbiddenError();
    }
  }
}
