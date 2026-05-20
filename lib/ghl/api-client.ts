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

/**
 * Result of a single page from the GHL contacts list endpoint.
 *
 * GHL's `/contacts/` listing returns pagination metadata under `meta` —
 * `startAfter` is a timestamp cursor, `startAfterId` is the tiebreaker.
 * Both must be passed back on the next request, or you'll page-jitter.
 *
 * `nextPageCursor` is whichever combined cursor token GHL gives us; if it's
 * null/undefined the caller treats the backfill as done.
 */
export interface GhlContactListPage {
  contacts: GhlContactFull[];
  total: number | null;
  nextStartAfter: number | null;
  nextStartAfterId: string | null;
  hasMore: boolean;
}

/**
 * List one page of contacts for a location from GHL. Used by the historical
 * backfill worker — NOT by webhooks (webhooks come push-style).
 *
 * Errors throw — the worker catches and reschedules the job with backoff so
 * the caller doesn't need defensive nulls here. A null return would silently
 * end the backfill prematurely, which is the wrong default.
 */
export async function listContactsFromGhl(
  locationId: string,
  opts: {
    companyId?: string;
    limit?: number;
    startAfter?: number | null;
    startAfterId?: string | null;
  } = {},
): Promise<GhlContactListPage> {
  if (!locationId) {
    throw new Error("listContactsFromGhl: locationId is required");
  }

  const accessToken = await getValidAccessToken(locationId, {
    companyId: opts.companyId,
  });

  const url = new URL(`${API_BASE}/contacts/`);
  url.searchParams.set("locationId", locationId);
  url.searchParams.set("limit", String(opts.limit ?? 100));
  if (opts.startAfter != null) url.searchParams.set("startAfter", String(opts.startAfter));
  if (opts.startAfterId) url.searchParams.set("startAfterId", opts.startAfterId);

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: API_VERSION,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `listContactsFromGhl HTTP ${response.status} for ${locationId} ` +
        `(token=${maskToken(accessToken)}). ${text.slice(0, 200)}`,
    );
  }

  const payload = (await response.json()) as {
    contacts?: GhlContactFull[];
    meta?: {
      total?: number;
      nextPageUrl?: string | null;
      startAfter?: number | null;
      startAfterId?: string | null;
    };
  };

  const contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  const meta = payload.meta ?? {};
  const nextStartAfter =
    typeof meta.startAfter === "number" ? meta.startAfter : null;
  const nextStartAfterId =
    typeof meta.startAfterId === "string" && meta.startAfterId.length > 0
      ? meta.startAfterId
      : null;

  // GHL signals "no more pages" by either omitting startAfter/startAfterId OR
  // returning fewer rows than the limit. Be defensive on both.
  const hasMore =
    contacts.length === (opts.limit ?? 100) &&
    (nextStartAfter !== null || nextStartAfterId !== null);

  return {
    contacts,
    total: typeof meta.total === "number" ? meta.total : null,
    nextStartAfter,
    nextStartAfterId,
    hasMore,
  };
}
