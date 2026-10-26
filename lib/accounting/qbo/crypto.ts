/**
 * AES-256-GCM encryption for QuickBooks OAuth tokens at rest. Same format as
 * lib/stripe-connect/crypto.ts (base64 of iv | ciphertext | authTag) but with its own key,
 * ACCOUNTING_ENC_KEY, so rotating another feature's key never breaks these tokens.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { QboConfigError } from "./config";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.ACCOUNTING_ENC_KEY;
  if (!raw) throw new QboConfigError("ACCOUNTING_ENC_KEY is not set. Generate one with `openssl rand -base64 32`.");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new QboConfigError(`ACCOUNTING_ENC_KEY decoded to ${key.length} bytes; it must be 32.`);
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, ct, cipher.getAuthTag()]).toString("base64");
}

export function decryptToken(packed: string): string {
  const buf = Buffer.from(packed, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES + 1) throw new Error("Stored token is corrupt.");
  const decipher = createDecipheriv(ALGO, getKey(), buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(buf.length - TAG_BYTES));
  return Buffer.concat([decipher.update(buf.subarray(IV_BYTES, buf.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}
