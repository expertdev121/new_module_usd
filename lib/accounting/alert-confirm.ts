/**
 * Signed "confirm you received this" links for alert email addresses.
 *
 * The test email carries a link; opening it and pressing Confirm proves the address belongs to a real inbox.
 * Only confirmed addresses get real failure alerts. The token binds one address to one organization, expires after
 * 7 days, and cannot be used for anything else (the signed body names its purpose).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const CONFIRM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PURPOSE = "alert-email";

/**
 * Its own signing key, derived from the app secret for this one purpose. Without this, a confirm link (which is emailed
 * to people who may not be admins) would also pass as another signed token made with the same secret, such as the
 * QuickBooks connect "state". With it, tokens from one purpose can never be accepted for another.
 */
function key(): Buffer {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set.");
  return createHmac("sha256", s).update(`donorhq:${PURPOSE}:confirm:v1`).digest();
}
const sign = (body: string) => createHmac("sha256", key()).update(body).digest("base64url");

export interface ConfirmClaim {
  locationId: string;
  email: string;
}

export function createConfirmToken(c: ConfirmClaim, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ p: PURPOSE, l: c.locationId, e: c.email.trim().toLowerCase(), t: now })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Returns what the link confirms, or null when the signature is wrong, it expired, or it is malformed. */
export function verifyConfirmToken(token: string, now = Date.now()): ConfirmClaim | null {
  if (typeof token !== "string" || token.length > 1000) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { p?: unknown; l?: unknown; e?: unknown; t?: unknown };
    if (p.p !== PURPOSE || typeof p.l !== "string" || typeof p.e !== "string" || typeof p.t !== "number") return null;
    if (now - p.t > CONFIRM_TTL_MS || p.t > now + 60_000) return null;
    return { locationId: p.l, email: p.e };
  } catch {
    return null;
  }
}

/** "ann@org.org" -> "a**@org.org": enough to recognise the address, not enough to harvest it from a link. */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "your address";
  return `${user[0]}${"*".repeat(Math.max(2, user.length - 1))}@${domain}`;
}
