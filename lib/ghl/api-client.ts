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

// ─────────────────────────────────────────────────────────────────────────────
// OUTBOUND — DonorHQ → GHL writes. Used by lib/ghl/push-contact.ts.
//
// We deliberately keep these thin: validate inputs, build the request body,
// fire the HTTP call, surface a clean error. The "what to push, when, and
// from whom" logic lives one layer up so this file stays grep-able.
// ─────────────────────────────────────────────────────────────────────────────

export interface GhlContactPushInput {
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
}

export interface GhlContactPushResult {
  ghlContactId: string;
  /** TRUE when GHL's upsert matched an existing contact instead of inserting. */
  isExisting: boolean;
}

/**
 * Upsert a contact into GHL. Used for creates AND for first-time pushes of
 * existing DonorHQ-only contacts. GHL's `/contacts/upsert` matches on
 * (locationId + email) or (locationId + phone) and returns the contactId
 * either way, so we never create duplicates against an existing GHL row.
 *
 * Returns the resolved ghl contactId. Caller is responsible for writing it
 * back to DonorHQ's contact row.
 */
export async function upsertContactInGhl(
  locationId: string,
  input: GhlContactPushInput,
  opts: { companyId?: string } = {},
): Promise<GhlContactPushResult> {
  if (!locationId) throw new Error("upsertContactInGhl: locationId required");
  if (!input.email && !input.phone) {
    throw new Error(
      "upsertContactInGhl: GHL upsert requires at least email or phone for dedup matching",
    );
  }

  const accessToken = await getValidAccessToken(locationId, {
    companyId: opts.companyId,
  });

  const body: Record<string, unknown> = {
    locationId,
    firstName: input.firstName ?? undefined,
    lastName: input.lastName ?? undefined,
    email: input.email ?? undefined,
    phone: input.phone ?? undefined,
    address1: input.address1 ?? undefined,
    city: input.city ?? undefined,
    state: input.state ?? undefined,
    postalCode: input.postalCode ?? undefined,
    country: input.country ?? undefined,
    companyName: input.companyName ?? undefined,
    dateOfBirth: input.dateOfBirth ?? undefined,
    source: input.source ?? undefined,
    tags: input.tags && input.tags.length > 0 ? input.tags : undefined,
    dnd: input.dnd,
  };

  const response = await fetch(`${API_BASE}/contacts/upsert`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: API_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `upsertContactInGhl HTTP ${response.status} for location ${locationId} ` +
        `(token=${maskToken(accessToken)}). ${text.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as {
    contact?: { id?: string };
    new?: boolean;
    traceId?: string;
  };

  const ghlContactId = payload.contact?.id;
  if (!ghlContactId) {
    throw new Error(
      `upsertContactInGhl: GHL response missing contact.id (location=${locationId}, traceId=${payload.traceId})`,
    );
  }

  return {
    ghlContactId,
    // GHL returns `new: true` when it inserted, `new: false` when it matched.
    // Treat absent as "we don't know" — default to false (existing) so the
    // caller doesn't loudly announce a create that may have been a match.
    isExisting: payload.new === false ? false : payload.new === true ? false : true,
  };
}

/**
 * Update an existing GHL contact by ID. Used when the DonorHQ row already
 * has a ghlContactId. Sparse — only fields present in `input` are sent;
 * undefined fields are left untouched by GHL.
 *
 * Pass `null` for a field (not `undefined`) to explicitly clear it in GHL.
 */
export async function updateContactInGhl(
  locationId: string,
  ghlContactId: string,
  input: GhlContactPushInput,
  opts: { companyId?: string } = {},
): Promise<void> {
  if (!locationId) throw new Error("updateContactInGhl: locationId required");
  if (!ghlContactId) throw new Error("updateContactInGhl: ghlContactId required");

  const accessToken = await getValidAccessToken(locationId, {
    companyId: opts.companyId,
  });

  // Strip undefined so we don't send literal `undefined`. Keep nulls — those
  // are intentional "clear this field" signals.
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) body[key] = value;
  }

  const response = await fetch(`${API_BASE}/contacts/${ghlContactId}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: API_VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `updateContactInGhl HTTP ${response.status} for ${ghlContactId} ` +
        `(token=${maskToken(accessToken)}). ${text.slice(0, 300)}`,
    );
  }
}

/**
 * Hard-delete a contact in GHL. Irreversible — the user opted into this
 * behaviour when configuring the sync ("Hard delete in GHL").
 *
 * GHL returns 200 + `{succeded: true}` (sic) on success, 404 if the contact
 * is already gone — we treat 404 as success since the end state matches.
 */
export async function deleteContactInGhl(
  locationId: string,
  ghlContactId: string,
  opts: { companyId?: string } = {},
): Promise<void> {
  if (!locationId) throw new Error("deleteContactInGhl: locationId required");
  if (!ghlContactId) throw new Error("deleteContactInGhl: ghlContactId required");

  const accessToken = await getValidAccessToken(locationId, {
    companyId: opts.companyId,
  });

  const response = await fetch(`${API_BASE}/contacts/${ghlContactId}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Version: API_VERSION,
      Accept: "application/json",
    },
  });

  if (response.status === 404) {
    // Already deleted in GHL — desired state reached.
    return;
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `deleteContactInGhl HTTP ${response.status} for ${ghlContactId} ` +
        `(token=${maskToken(accessToken)}). ${text.slice(0, 300)}`,
    );
  }
}

/**
 * Add one or more tags to a contact in GHL. GHL accepts tag NAMES (not IDs)
 * and creates them server-side if they don't exist yet for the location.
 *
 * No-op when the tag list is empty.
 */
export async function addTagsToContactInGhl(
  locationId: string,
  ghlContactId: string,
  tags: string[],
  opts: { companyId?: string } = {},
): Promise<void> {
  if (!locationId) throw new Error("addTagsToContactInGhl: locationId required");
  if (!ghlContactId) throw new Error("addTagsToContactInGhl: ghlContactId required");
  const cleaned = tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (cleaned.length === 0) return;

  const accessToken = await getValidAccessToken(locationId, {
    companyId: opts.companyId,
  });

  const response = await fetch(
    `${API_BASE}/contacts/${ghlContactId}/tags`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: API_VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: cleaned }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `addTagsToContactInGhl HTTP ${response.status} for ${ghlContactId} ` +
        `(token=${maskToken(accessToken)}). ${text.slice(0, 300)}`,
    );
  }
}

/**
 * Remove one or more tags from a contact in GHL. Counterpart to
 * addTagsToContactInGhl. No-op when the tag list is empty.
 */
export async function removeTagsFromContactInGhl(
  locationId: string,
  ghlContactId: string,
  tags: string[],
  opts: { companyId?: string } = {},
): Promise<void> {
  if (!locationId) throw new Error("removeTagsFromContactInGhl: locationId required");
  if (!ghlContactId) throw new Error("removeTagsFromContactInGhl: ghlContactId required");
  const cleaned = tags
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (cleaned.length === 0) return;

  const accessToken = await getValidAccessToken(locationId, {
    companyId: opts.companyId,
  });

  const response = await fetch(
    `${API_BASE}/contacts/${ghlContactId}/tags`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: API_VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tags: cleaned }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `removeTagsFromContactInGhl HTTP ${response.status} for ${ghlContactId} ` +
        `(token=${maskToken(accessToken)}). ${text.slice(0, 300)}`,
    );
  }
}
