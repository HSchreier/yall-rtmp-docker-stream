// Session extraction — the one piece of "how do I know who's calling"
// shared by every module router. Kept here rather than duplicated in each
// router or folded into AuthService, which only verifies a raw token and
// shouldn't know anything about cookies/headers.

import type { AuthService, JwtPayload } from "../modules/auth/auth.service.ts";
import { AuthError } from "./errors.ts";
import { BEARER_TOKEN_RE } from "./validators.ts";

const SESSION_COOKIE_RE = /(?:^|;\s*)session=([^;]+)/;

export function tryAuth(req: Request, auth: AuthService): JwtPayload | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader && BEARER_TOKEN_RE.test(authHeader)) {
    const token = authHeader.slice(7); // Remove "Bearer " prefix
    return auth.verifyToken(token);
  }
  const cookieHeader = req.headers.get("cookie");
  const token = cookieHeader?.match(SESSION_COOKIE_RE)?.[1];
  return token ? auth.verifyToken(token) : null;
}

export function requireAuth(req: Request, auth: AuthService): JwtPayload {
  const user = tryAuth(req, auth);
  if (!user) throw new AuthError();
  return user;
}
