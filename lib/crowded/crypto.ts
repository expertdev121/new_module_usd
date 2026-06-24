/**
 * AES-256-GCM encryption for Crowded credentials at rest.
 *
 * What gets encrypted:
 *   - The admin's Crowded Partner API key
 *   - The webhook signing secret Crowded gives us at registration
 *
 * Why GCM: authenticated encryption — tampering invalidates the auth tag
 * on decrypt. So a stolen DB row can't be partially modified without us
 * noticing. Same family Stripe / Twilio use internally.
 *
 * Format on disk: base64(iv | ciphertext | authTag), all bytes concatenated.
 * 12-byte IV (NIST recommended for GCM), variable ciphertext, 16-byte tag.
 *
 * Key source: env var CROWDED_ENC_KEY — must be 32 bytes of entropy,
 * provided as a base64-encoded string (44 chars). Generate with:
 *   openssl rand -base64 32
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Resolve the AES key from env. Lazily checked on first use so import
 * doesn't crash when Crowded code is imported but never called (e.g. in
 * a separate route's bundle on cold start).
 */
function getKey(): Buffer {
  const raw = process.env.CROWDED_ENC_KEY;
  if (!raw) {
    throw new Error(
      "CROWDED_ENC_KEY is not set. Generate one with `openssl rand -base64 32` " +
        "and add to .env / Vercel env vars. It must be 32 bytes (44 base64 chars).",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `CROWDED_ENC_KEY decoded to ${key.length} bytes — must be 32. ` +
        `Regenerate with \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

/**
 * Encrypt a UTF-8 string. Returns base64 of (iv | ct | tag). Each call
 * picks a fresh random IV — same plaintext encrypts to a different
 * ciphertext every time, so the DB column isn't trivially fingerprintable.
 */
export function encryptSecret(plaintext: string): string {
  if (typeof plaintext !== "string") {
    throw new Error("encryptSecret: plaintext must be a string");
  }
  const key = getKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

/**
 * Decrypt a base64-encoded ciphertext produced by encryptSecret. Throws
 * if the auth tag fails — caller treats that as a tampered row, NOT a
 * silent miss.
 */
export function decryptSecret(packed: string): string {
  if (typeof packed !== "string") {
    throw new Error("decryptSecret: packed must be a string");
  }
  const buf = Buffer.from(packed, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("decryptSecret: ciphertext too short — corrupt or empty?");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}

/**
 * Last-4 mask for display — used in admin UI to show the user that *a*
 * token is on file without revealing it. Returns 'sk_••••abcd' style.
 */
export function maskToken(plaintext: string | null | undefined): string {
  if (!plaintext) return "••••";
  if (plaintext.length <= 4) return "••••";
  return `••••${plaintext.slice(-4)}`;
}
