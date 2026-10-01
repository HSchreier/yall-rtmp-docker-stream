import { describe, expect, test } from "bun:test";
import { decryptSecret, encryptSecret } from "../../src/infra/crypto.ts";

const KEY = Buffer.from("11".repeat(32), "hex");
const OTHER_KEY = Buffer.from("22".repeat(32), "hex");

describe("encryptSecret/decryptSecret", () => {
  test("round-trips a plaintext value", () => {
    const ciphertext = encryptSecret("my-stream-key", KEY);
    expect(decryptSecret(ciphertext, KEY)).toBe("my-stream-key");
  });

  test("the same plaintext produces different ciphertext each call", () => {
    const a = encryptSecret("same-value", KEY);
    const b = encryptSecret("same-value", KEY);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, KEY)).toBe("same-value");
    expect(decryptSecret(b, KEY)).toBe("same-value");
  });

  test("decrypting with the wrong key throws instead of returning garbage", () => {
    const ciphertext = encryptSecret("my-stream-key", KEY);
    expect(() => decryptSecret(ciphertext, OTHER_KEY)).toThrow();
  });

  test("a tampered ciphertext fails to decrypt (GCM auth tag catches it)", () => {
    const ciphertext = encryptSecret("my-stream-key", KEY);
    const raw = Buffer.from(ciphertext, "base64");
    const lastByte = raw.at(-1) ?? 0;
    raw[raw.length - 1] = lastByte ^ 0xff; // flip the last ciphertext byte
    const tampered = raw.toString("base64");
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });
});
