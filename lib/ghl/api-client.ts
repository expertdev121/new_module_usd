/**
 * Thin client for GHL REST API calls that need a fresh access token.
 *
 * Lives in its own file (not oauth-client.ts) to avoid a circular import
 * with get-access-token.ts. Always uses getValidAccessToken(), which
 * handles lazy-mint + refresh transparently.
 */
import { getValidAccessToken } from "./get-access-token";
import { maskToken } from "./oauth-client";

const API_BASE =
  process.env.GHL_API_BASE_URL || "https://services.leadconnectorhq.com";
const API_VERSION = process.env.GHL_API_VERSION || "2021-07-28";

/**
 * Full GHL contact object — the subset of fields we care about for sync.
 * GHL returns more; we extract what's useful + tolerate extras.
 */
export interface GhlContactFull {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  companyName?: string | null;
  dateOfBirth?: string | null;
  source?: string | null;
  tags?: string[];
  dnd?: boolean;
  customFields?: Array<{ id: string; value: unknown }> | Record<string, unknown>;
}

/**
 * Fetch a contact from GHL's API. Used after webhook events to get the
 * canonical state — GHL's webhook payloads are sparse (e.g. ContactUpdate
 * omits phone, address1, city, state, postalCode) so we re-fetch to keep
 * Donor HQ in sync.
 *
 * Returns null on any error (network, 404, auth issue). Callers should
 * treat null as "couldn't enrich, keep existing values" — never as
 * "contact has no data".
 */
export async function fetchContactFromGhl(
  locationId: string,
  ghlContactId: string,
  opts: { companyId?: string } = {},
): Promise<GhlContactFull | null> {
  if (!locationId || !ghlContactId) return null;

  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(locationId, opts);
  } catch (err) {
    console.error(
      `[ghl-api] couldn't get access token for ${locationId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  try {
    const response = await fetch(`${API_BASE}/contacts/${ghlContactId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: API_VERSION,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `[ghl-api] fetchContactFromGhl: HTTP ${response.status} for ${ghlContactId} ` +
          `(token=${maskToken(accessToken)}). ${text.slice(0, 200)}`,
      );
      return null;
    }

    const payload = (await response.json()) as
      | { contact?: GhlContactFull }
      | GhlContactFull;

    // GHL responses sometimes wrap the contact under `.contact`, sometimes not.
    if (payload && typeof payload === "object" && "contact" in payload) {
      return (payload as { contact: GhlContactFull }).contact;
    }
    return payload as GhlContactFull;
  } catch (err) {
    console.error(
      `[ghl-api] fetchContactFromGhl network error for ${ghlContactId}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
