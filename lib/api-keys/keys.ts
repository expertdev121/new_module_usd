/**
 * Token generation + hashing for the public Integrations API.
 *
 * Token shape:  dhq_live_<40 hex chars>
 *   - "dhq_"   brand/namespace so a leaked key is greppable and obvious.
 *   - "live_"  environment marker (room for "test_" later).
 *   - 20 random bytes -> 40 hex chars of entropy (160 bits).
 *
 * We never persist the raw token. We store sha256(token) and match against
 * it on each request. sha256 (not bcrypt) is correct here: these are
 * high-entropy random tokens, not user-chosen passwords, so there is
 * nothing to brute-force and we need constant, index-friendly lookups.
 */
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "dhq_live_";
/** Chars kept in key_prefix for display/identification (prefix + first 4 of secret). */
const DISPLAY_PREFIX_LEN = TOKEN_PREFIX.length + 4;

export interface GeneratedKey {
  /** Full token — shown to the user exactly once, never stored raw. */
  token: string;
  /** Leading visible slice we persist for identification in the dashboard. */
  prefix: string;
  /** sha256 hex we persist and match on. */
  hash: string;
}

export function generateApiKey(): GeneratedKey {
  const secret = randomBytes(20).toString("hex"); // 40 hex chars
  const token = `${TOKEN_PREFIX}${secret}`;
  return {
    token,
    prefix: token.slice(0, DISPLAY_PREFIX_LEN),
    hash: hashApiKey(token),
  };
}

export function hashApiKey(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time compare of two sha256 hex digests. */
export function hashesEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

/**
 * Pull the bearer token out of a request. Accepts either
 *   Authorization: Bearer dhq_live_xxx
 * or the convenience header
 *   x-api-key: dhq_live_xxx
 * Returns null when neither is present.
 */
export function extractToken(headers: Headers): string | null {
  const auth = headers.get("authorization");
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const x = headers.get("x-api-key");
  if (x) return x.trim();
  return null;
}
