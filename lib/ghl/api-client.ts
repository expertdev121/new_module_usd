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

// ─────────────────────────────────────────────────────────────────────────────
// PAYMENT PULL — GHL → DonorHQ.
//
// Four sources, four endpoints, four pagination conventions. Each helper
// returns a normalized GhlPaymentListPage so the backfill worker can stay
// dumb. We keep the shape generic: the worker turns each row into a
// manual_donation insert via mapping in payments-backfill.ts.
//
// Cursor: each endpoint uses a numeric `offset` or `page` style cursor.
// We squash it into a single string field on the job row to reuse the
// existing ghl_backfill_jobs.cursor column.
// ─────────────────────────────────────────────────────────────────────────────

export interface GhlPaymentRecord {
  /** Unique GHL ID for this payment object (transaction id / invoice id / etc). */
  id: string;
  /** Linked GHL contact id, if any. */
  contactId?: string | null;
  /** Cents or whole units depending on source; we store amount/currency raw. */
  amount: number | null;
  currency: string | null;
  /** ISO timestamp of when the payment landed. */
  paidAt: string | null;
  /** card / ach / cash / manual / etc. — passed through. */
  paymentMethod: string | null;
  /** status: succeeded / paid / pending / failed / refunded — passed through. */
  status: string | null;
  /** Source-specific reference (invoice number, order number, etc.). */
  referenceNumber: string | null;
  /** Free-form note for the row (e.g. invoice description, product name). */
  description: string | null;
  /** Original GHL object kept around for debugging / future fields. */
  raw: Record<string, unknown>;
}

export interface GhlPaymentListPage {
  records: GhlPaymentRecord[];
  /** Encoded cursor for the next page, or null when done. */
  nextCursor: string | null;
  /** GHL's reported total, if it provides one. */
  total: number | null;
}

/**
 * `GET /payments/transactions` — every successful charge. Most complete
 * view of money in. Paginated with `offset` + `limit`.
 */
export async function listTransactionsFromGhl(
  locationId: string,
  opts: { companyId?: string; limit?: number; cursor?: string | null } = {},
): Promise<GhlPaymentListPage> {
  return await paginatedListGet(
    locationId,
    "payments/transactions",
    opts,
    normalizeTransaction,
  );
}

/**
 * `GET /payments/subscriptions` — recurring plans + their charges. We
 * pull the list to materialize each subscription's charges as
 * manual_donation rows. Pagination same offset/limit.
 */
export async function listSubscriptionsFromGhl(
  locationId: string,
  opts: { companyId?: string; limit?: number; cursor?: string | null } = {},
): Promise<GhlPaymentListPage> {
  return await paginatedListGet(
    locationId,
    "payments/subscriptions",
    opts,
    normalizeSubscription,
  );
}

/**
 * `GET /invoices/list?status=paid` — paid invoices only. Paginated with
 * `offset` + `limit`; the `status` filter lives in the same query string.
 */
export async function listInvoicesFromGhl(
  locationId: string,
  opts: { companyId?: string; limit?: number; cursor?: string | null } = {},
): Promise<GhlPaymentListPage> {
  const extra: Record<string, string> = { status: "paid" };
  return await paginatedListGet(
    locationId,
    "invoices/",
    opts,
    normalizeInvoice,
    extra,
  );
}

/**
 * `GET /payments/orders` — funnel + checkout orders. Pagination same.
 */
export async function listOrdersFromGhl(
  locationId: string,
  opts: { companyId?: string; limit?: number; cursor?: string | null } = {},
): Promise<GhlPaymentListPage> {
  return await paginatedListGet(
    locationId,
    "payments/orders",
    opts,
    normalizeOrder,
  );
}

// ─── shared paginator + normalizers ─────────────────────────────────────────

async function paginatedListGet(
  locationId: string,
  path: string,
  opts: { companyId?: string; limit?: number; cursor?: string | null },
  normalize: (item: Record<string, unknown>) => GhlPaymentRecord,
  extraQs: Record<string, string> = {},
): Promise<GhlPaymentListPage> {
  if (!locationId) {
    throw new Error(`${path}: locationId required`);
  }
  const accessToken = await getValidAccessToken(locationId, {
    companyId: opts.companyId,
  });

  const limit = opts.limit ?? 100;
  const offset = parseOffsetCursor(opts.cursor);

  const url = new URL(`${API_BASE}/${path}`);
  url.searchParams.set("locationId", locationId);
  url.searchParams.set("altId", locationId);
  url.searchParams.set("altType", "location");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  for (const [k, v] of Object.entries(extraQs)) url.searchParams.set(k, v);

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
      `${path} HTTP ${response.status} for ${locationId} ` +
        `(token=${maskToken(accessToken)}). ${text.slice(0, 300)}`,
    );
  }

  const payload = (await response.json()) as Record<string, unknown>;
  // GHL's list response shape varies by endpoint. Look for any of the
  // common wrapper keys; default to an empty array.
  const items = (payload.data ??
    payload.transactions ??
    payload.subscriptions ??
    payload.invoices ??
    payload.orders ??
    []) as Record<string, unknown>[];
  const total =
    typeof payload.total === "number"
      ? payload.total
      : typeof payload.totalCount === "number"
        ? payload.totalCount
        : null;

  const records = items.map(normalize);

  // hasMore = we got a full page; the next call uses offset += limit.
  const hasMore = records.length === limit;
  const nextCursor = hasMore ? encodeOffsetCursor(offset + limit) : null;

  return { records, nextCursor, total };
}

function encodeOffsetCursor(offset: number): string {
  return `offset:${offset}`;
}
function parseOffsetCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const m = cursor.match(/^offset:(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

// ─── normalizers ────────────────────────────────────────────────────────────

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function normalizeTransaction(t: Record<string, unknown>): GhlPaymentRecord {
  return {
    id: String(t._id ?? t.id ?? ""),
    contactId: pickString(t, "contactId", "contact_id"),
    amount: pickNumber(t, "amount", "amountInCents", "amount_in_cents"),
    currency: pickString(t, "currency"),
    paidAt: pickString(t, "createdAt", "completedAt", "paidAt", "transactionDate"),
    paymentMethod: pickString(t, "paymentMethod", "paymentMethodType", "type"),
    status: pickString(t, "status", "paymentStatus"),
    referenceNumber: pickString(t, "transactionNumber", "referenceNumber"),
    description: pickString(t, "description"),
    raw: t,
  };
}

function normalizeSubscription(s: Record<string, unknown>): GhlPaymentRecord {
  // Subscriptions don't have a single "paid at" — they're recurring plans.
  // We treat each subscription row as a single source record; future
  // versions can expand into charges via /subscriptions/{id}/transactions.
  return {
    id: String(s._id ?? s.id ?? ""),
    contactId: pickString(s, "contactId", "contact_id"),
    amount: pickNumber(s, "amount", "amountInCents"),
    currency: pickString(s, "currency"),
    paidAt: pickString(s, "createdAt", "startDate", "nextChargeDate"),
    paymentMethod: pickString(s, "paymentMethod", "type"),
    status: pickString(s, "status", "subscriptionStatus"),
    referenceNumber: pickString(s, "subscriptionNumber", "referenceNumber"),
    description: pickString(s, "description", "name"),
    raw: s,
  };
}

function normalizeInvoice(inv: Record<string, unknown>): GhlPaymentRecord {
  return {
    id: String(inv._id ?? inv.id ?? ""),
    contactId: pickString(inv, "contactId", "contact_id"),
    amount: pickNumber(inv, "total", "amount", "amountPaid"),
    currency: pickString(inv, "currency"),
    paidAt: pickString(inv, "paidAt", "issueDate", "updatedAt", "createdAt"),
    paymentMethod: pickString(inv, "paymentMethod"),
    status: pickString(inv, "status"),
    referenceNumber: pickString(inv, "invoiceNumber", "name"),
    description: pickString(inv, "title", "description", "name"),
    raw: inv,
  };
}

function normalizeOrder(o: Record<string, unknown>): GhlPaymentRecord {
  return {
    id: String(o._id ?? o.id ?? ""),
    contactId: pickString(o, "contactId", "contact_id"),
    amount: pickNumber(o, "amount", "total"),
    currency: pickString(o, "currency"),
    paidAt: pickString(o, "createdAt", "completedAt", "paidAt"),
    paymentMethod: pickString(o, "paymentMethod", "paymentMethodType"),
    status: pickString(o, "status"),
    referenceNumber: pickString(o, "orderNumber", "referenceNumber"),
    description: pickString(o, "description", "productName"),
    raw: o,
  };
}
