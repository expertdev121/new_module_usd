/**
 * CSRF state cookie helpers for the GHL OAuth install flow.
 *
 * Flow:
 *   1. /api/oauth/install generates a random `state` token, stores it in
 *      a signed-style HTTP-only cookie, and includes the same value in the
 *      redirect to GHL's authorize URL.
 *   2. /api/oauth/callback reads the `?state=` query param and the cookie,
 *      compares them with crypto.timingSafeEqual, and rejects mismatches.
 *
 * The cookie itself is HTTP-only and not readable from client JS, so an opaque
 * random value is sufficient — we don't need to sign it because the cookie can
 * only be set by our server.
 */
import crypto from "node:crypto";

export const STATE_COOKIE_NAME = "ghl_oauth_state";
const STATE_TTL_SECONDS = 10 * 60; // 10 minutes — install flow should complete well within this

/** 32 random bytes, base64url-encoded — opaque, ~43 chars. */
export function generateStateToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Constant-time comparison so an attacker can't time the validation. */
export function isStateValid(stateFromQuery: string | null, stateFromCookie: string | null): boolean {
  if (!stateFromQuery || !stateFromCookie) return false;
  if (stateFromQuery.length !== stateFromCookie.length) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(stateFromQuery),
      Buffer.from(stateFromCookie),
    );
  } catch {
    return false;
  }
}

/** Cookie options used when setting OR clearing the state cookie. */
export function getStateCookieOptions() {
  return {
    name: STATE_COOKIE_NAME,
    httpOnly: true as const,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: STATE_TTL_SECONDS,
  };
}
