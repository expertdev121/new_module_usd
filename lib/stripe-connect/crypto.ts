/**
 * AES-256-GCM encryption for Stripe secret keys at rest.
 *
 * What gets encrypted: the tenant's Stripe secret key (sk_test_.../sk_live_...).
 * The publishable key is not secret and is stored in plaintext.
 *
 * Same format/algorithm as lib/crowded/crypto.ts (see that file for the
 * rationale). Uses its own env var so a Crowded key rotation doesn't
 * invalidate Stripe secrets and vice versa.
 *
 * Format on disk: base64(iv | ciphertext | authTag). 12-byte IV, 16-byte tag.
 * Key source: env var STRIPE_CONNECT_ENC_KEY — 32 bytes, base64-encoded.
 * Generate with: openssl rand -base64 32
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.STRIPE_CONNECT_ENC_KEY;
  if (!raw) {
    throw new Error(
      "STRIPE_CONNECT_ENC_KEY is not set. Generate one with `openssl rand -base64 32` " +
        "and add to .env / Vercel env vars. It must be 32 bytes (44 base64 chars).",
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `STRIPE_CONNECT_ENC_KEY decoded to ${key.length} bytes — must be 32. ` +
        `Regenerate with \`openssl rand -base64 32\`.`,
    );
  }
  return key;
}

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

/** Last-4 mask for display — 'sk_••••abcd' style. */
export function maskToken(plaintext: string | null | undefined): string {
  if (!plaintext) return "••••";
  if (plaintext.length <= 4) return "••••";
  return `••••${plaintext.slice(-4)}`;
}
