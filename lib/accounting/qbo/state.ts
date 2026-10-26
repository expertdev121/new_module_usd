/**
 * Signed OAuth "state" for the QuickBooks connect flow. It binds the round trip to the admin who
 * started it (location + user) and expires after 10 minutes, so a callback link cannot be replayed
 * by someone else or used to connect a company to the wrong organization (CSRF protection).
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL_MS = 10 * 60 * 1000;

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set.");
  return s;
}

const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

export interface OAuthState {
  locationId: string;
  userId: number | null;
}

export function createState(s: OAuthState, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ l: s.locationId, u: s.userId, t: now, n: randomBytes(8).toString("hex") })).toString("base64url");
  return `${body}.${sign(body)}`;
}

/** Returns the state, or null if the signature is wrong, it expired, or it is malformed. */
export function verifyState(token: string, now = Date.now()): OAuthState | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { l?: unknown; u?: unknown; t?: unknown };
    if (typeof p.l !== "string" || typeof p.t !== "number") return null;
    if (now - p.t > TTL_MS || p.t > now + 60_000) return null;
    return { locationId: p.l, userId: typeof p.u === "number" ? p.u : null };
  } catch {
    return null;
  }
}
