// Field-level encryption for secrets at rest — destination stream keys
// (Mixcloud/YouTube/Twitch) are the actual RTMP credentials for someone's
// account; storing them as plaintext in Mongo means anyone with DB access
// (a backup, a misconfigured export, an attacker who gets the connection
// string) walks away with live stream keys. AES-256-GCM: authenticated
// encryption, so a tampered ciphertext fails to decrypt instead of silently
// producing garbage — needed here since a corrupted/tampered key would
// otherwise fail far downstream, at the RTMP push, with a confusing error.
//
// A random 12-byte IV per call (GCM's recommended size) — reusing an IV
// with the same key breaks GCM's confidentiality guarantee, so encrypting
// the same value twice must never produce the same ciphertext, and it
// doesn't. IV + auth tag + ciphertext are stored together (not derivable
// from each other), base64-encoded as one string, so the repository can
// treat the result as an opaque blob without a second column.
//
// Key rotation is NOT handled here — an ENCRYPTION_KEY change makes every
// previously-encrypted value undecryptable. That's flagged, not solved:
// see docs/TECHNICAL.md's open questions.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export function decryptSecret(encoded: string, key: Buffer): string {
  const raw = Buffer.from(encoded, "base64");
  const iv = raw.subarray(0, IV_LENGTH);
  const authTag = raw.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = raw.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
