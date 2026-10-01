// Small HTTP response/body helpers shared by every module router — kept
// framework-free (Bun.serve + the Request/Response Web APIs only), same
// "no framework where unnecessary" call as http-api.ts itself.

import { ValidationError } from "./errors.ts";

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

export function sessionCookie(token: string, maxAgeSeconds = 43200): string {
  return `session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new ValidationError("Malformed JSON body");
  }
}
