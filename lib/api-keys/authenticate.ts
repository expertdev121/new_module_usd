/**
 * Resolve an incoming public-API request to a tenant + scopes.
 *
 * The token is the ONLY source of the location id — the caller never sends
 * it — so a key can only ever touch its own account's data. We look the key
 * up by sha256(token), reject revoked keys, and stamp last_used_at.
 */
import { db } from "@/lib/db";
import { apiKey, type ApiScope } from "@/lib/db/schema-api";
import { and, eq, isNull } from "drizzle-orm";
import { extractToken, hashApiKey } from "./keys";

export interface ApiAuthContext {
  keyId: string;
  locationId: string;
  scopes: string[];
}

export type ApiAuthResult =
  | { ok: true; ctx: ApiAuthContext }
  | { ok: false; status: 401 | 403; error: string };

/**
 * Authenticate a request. On success returns the tenant context; on failure
 * returns an HTTP status + message the route can hand straight back.
 */
export async function authenticateApiRequest(
  headers: Headers,
): Promise<ApiAuthResult> {
  const token = extractToken(headers);
  if (!token) {
    return {
      ok: false,
      status: 401,
      error:
        "Missing API key. Send it as 'Authorization: Bearer <key>' or the 'x-api-key' header.",
    };
  }

  const hash = hashApiKey(token);
  const rows = await db
    .select({
      id: apiKey.id,
      locationId: apiKey.locationId,
      scopes: apiKey.scopes,
    })
    .from(apiKey)
    .where(and(eq(apiKey.keyHash, hash), isNull(apiKey.revokedAt)))
    .limit(1);

  const key = rows[0];
  if (!key) {
    return { ok: false, status: 401, error: "Invalid or revoked API key." };
  }

  // Best-effort usage stamp — never block the request on it.
  void db
    .update(apiKey)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKey.id, key.id))
    .catch(() => {});

  return {
    ok: true,
    ctx: {
      keyId: key.id,
      locationId: key.locationId,
      scopes: key.scopes ?? [],
    },
  };
}

/** Guard: does this authenticated key hold the scope the endpoint needs? */
export function requireScope(
  ctx: ApiAuthContext,
  scope: ApiScope,
): { ok: true } | { ok: false; status: 403; error: string } {
  if (ctx.scopes.includes(scope)) return { ok: true };
  return {
    ok: false,
    status: 403,
    error: `This API key is missing the required scope '${scope}'.`,
  };
}
