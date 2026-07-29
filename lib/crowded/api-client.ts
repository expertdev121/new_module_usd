/**
 * Typed REST wrapper for the Crowded Partner API.
 *
 * Auth: bearer token (Crowded "Partner API key"). One token per partner.
 * Every call carries `Authorization: Bearer <token>`.
 *
 * Idempotency: writes (createCollection / createIntent / registerWebhook)
 * accept an optional `idempotencyKey` — we generate one per logical action
 * upstream so retries don't double-create. Crowded honours the standard
 * `Idempotency-Key` header.
 *
 * Errors: anything non-2xx throws a CrowdedApiError with the parsed body,
 * the HTTP code, and a `isAuthError` flag for the connection module to
 * flip its status to `needs_reconnect`.
 */
import { randomUUID } from "node:crypto";

// Default to Crowded's SANDBOX host. Their production API host is
// api.crowdedfinance.com (or api.bankingcrowded.com in older docs) —
// switch via the CROWDED_API_BASE_URL env var when going live.
//
// Sandbox URL confirmed working with partner-role JWTs returning real
// chapter + webhook data. Production host sits behind a stricter
// Cloudflare bot-challenge from non-allowlisted IPs.
const API_BASE =
  process.env.CROWDED_API_BASE_URL ?? "https://sandbox-api.crowdedfinance.com";

// ─── Types — only the fields we depend on. Crowded sends more; we tolerate it. ─

export interface CrowdedChapter {
  id: string;
  name: string;
  organizationId?: string;
  /** Some Crowded responses nest org info — accept either flat or nested. */
  organization?: { id?: string; name?: string };
}

export interface CrowdedCollection {
  id: string;
  title: string;
  requestedAmount?: number | null;
  goalAmount?: number | null;
  recurringPaymentsEnabled?: boolean;
  chapterId?: string;
}

export interface CrowdedIntent {
  /** The donor-facing URL on Crowded's hosted checkout. */
  paymentUrl: string;
  /** Some responses include the intent id; not assumed. */
  id?: string;
  contactId?: string;
}

export interface CrowdedWebhookRegistration {
  id: string;
  url: string;
  events: string[];
  /** Returned ONCE — store encrypted immediately. */
  secret?: string;
}

export type CrowdedPaymentMethod = "card" | "ach" | "bank" | string;

export interface CrowdedPaymentPlanInput {
  type: "recurring" | "installment";
  timeInterval: "weekly" | "monthly" | "quarterly" | "yearly";
  paymentsCount?: number;
}

// ─── Error type ────────────────────────────────────────────────────────────

export class CrowdedApiError extends Error {
  status: number;
  body: unknown;
  /**
   * TRUE only for a REAL authentication failure — i.e. the token itself is
   * invalid/revoked. False for feature-gate 401s like "Permission denied"
   * (chapter lacks a specific feature such as recurring payments). Callers
   * use this to decide whether to mark the connection needs_reconnect.
   */
  isAuthError: boolean;
  /**
   * TRUE for 401/403 where the token is fine but the action is disallowed
   * on this chapter (missing feature, missing role, etc.). Do NOT flip the
   * connection to needs_reconnect — surface a specific error instead.
   */
  isPermissionDenied: boolean;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "CrowdedApiError";
    this.status = status;
    this.body = body;
    const bodyMsg =
      body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message ?? "")
        : "";
    // Crowded returns 401 with message "Permission denied." when the token
    // is valid but the requested action is feature-gated on their side.
    // Real auth failures return other messages (e.g. "Unauthorized",
    // "Invalid token", "Token expired").
    const looksLikePermission = /permission\s*denied/i.test(bodyMsg);
    this.isPermissionDenied =
      (status === 401 || status === 403) && looksLikePermission;
    this.isAuthError =
      (status === 401 || status === 403) && !looksLikePermission;
  }
}

// ─── Low-level fetch wrapper ───────────────────────────────────────────────

interface RequestOpts {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  /** Idempotency-Key header — caller responsible for stability across retries. */
  idempotencyKey?: string;
  /** Override for tests / Crowded sandbox. */
  baseUrl?: string;
  /**
   * Crowded's REST API uses a JSON:API-style `{ data: ... }` envelope for
   * both request bodies and responses. Default TRUE: wrap `body` in
   * `{ data: body }` on send and unwrap `.data` from the response. Set FALSE
   * for the rare endpoint that doesn't follow the convention.
   */
  envelope?: boolean;
}

async function crowdedFetch<T>(
  apiToken: string,
  path: string,
  opts: RequestOpts = {},
): Promise<T> {
  const base = opts.baseUrl ?? API_BASE;
  const url = `${base}${path}`;
  const useEnvelope = opts.envelope !== false;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiToken}`,
    Accept: "application/json",
  };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(useEnvelope ? { data: opts.body } : opts.body);
  }
  if (opts.idempotencyKey) {
    headers["Idempotency-Key"] = opts.idempotencyKey;
  }

  const response = await fetch(url, {
    method: opts.method ?? "GET",
    headers,
    body,
  });

  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = await response.text().catch(() => "");
    }
    throw new CrowdedApiError(
      `Crowded ${opts.method ?? "GET"} ${path} → HTTP ${response.status}`,
      response.status,
      parsed,
    );
  }

  // Some DELETE endpoints return 204 with no body — be tolerant.
  if (response.status === 204) return null as unknown as T;
  const json = (await response.json()) as unknown;
  if (
    useEnvelope &&
    json &&
    typeof json === "object" &&
    "data" in json &&
    (json as { data: unknown }).data !== undefined
  ) {
    return (json as { data: T }).data;
  }
  return json as T;
}

// ─── Public API surface ────────────────────────────────────────────────────

/**
 * Validate a partner token + list the partner's chapters (sub-accounts).
 * Used on the connect screen for both validation and the chapter picker.
 */
export async function listChapters(apiToken: string): Promise<CrowdedChapter[]> {
  const payload = await crowdedFetch<unknown>(apiToken, "/api/v1/chapters");
  // Tolerate either flat array or { data: [...] } wrapper.
  if (Array.isArray(payload)) return payload as CrowdedChapter[];
  if (
    payload &&
    typeof payload === "object" &&
    "data" in payload &&
    Array.isArray((payload as { data: unknown }).data)
  ) {
    return (payload as { data: CrowdedChapter[] }).data;
  }
  return [];
}

/**
 * Create a collection (= a Crowded form). `title` <=50 chars per docs.
 *
 * - `dues` form → omit requestedAmount (open donation) ❌ no, dues = fixed
 *   so requestedAmount IS required for dues, omitted for donation.
 *   We pass through whatever the caller chose.
 */
export async function createCollection(
  apiToken: string,
  chapterId: string,
  input: {
    title: string;
    /** cents, min 100. Required for `dues` forms; omit for `donation`. */
    requestedAmount?: number;
    /** cents, optional goal display. */
    goalAmount?: number;
    recurringPaymentsEnabled?: boolean;
  },
  idempotencyKey?: string,
): Promise<CrowdedCollection> {
  return crowdedFetch<CrowdedCollection>(
    apiToken,
    `/api/v1/chapters/${chapterId}/collections`,
    {
      method: "POST",
      body: input,
      idempotencyKey: idempotencyKey ?? randomUUID(),
    },
  );
}

/**
 * Create a payment intent for a donor. Returns `paymentUrl` we redirect
 * to (or hand to the embedded widget once that SDK is documented).
 */
export async function createIntent(
  apiToken: string,
  chapterId: string,
  collectionId: string,
  input: {
    /** cents, min 100. */
    requestedAmount: number;
    payerIp: string;
    userConsented: true;
    firstName?: string;
    lastName?: string;
    email?: string;
    mobile?: string;
    contactId?: string;
    successUrl?: string;
    failureUrl?: string;
    paymentPlan?: CrowdedPaymentPlanInput;
  },
  idempotencyKey?: string,
): Promise<CrowdedIntent> {
  return crowdedFetch<CrowdedIntent>(
    apiToken,
    `/api/v1/chapters/${chapterId}/collections/${collectionId}/intents`,
    {
      method: "POST",
      body: input,
      idempotencyKey: idempotencyKey ?? randomUUID(),
    },
  );
}

/**
 * Issue a short-lived access token for the embedded Crowded UI components.
 * Used by the eventual inline-checkout path; today we redirect instead.
 */
export async function createEmbeddedToken(
  apiToken: string,
  chapterId: string,
  contactId: string,
): Promise<{ accessToken: string; expiresAt?: string }> {
  return crowdedFetch(
    apiToken,
    `/api/v1/chapters/${chapterId}/contacts/${contactId}/embedded-token`,
    { method: "POST" },
  );
}

/**
 * Register a webhook subscription. Crowded returns the signing `secret`
 * EXACTLY ONCE — caller must encrypt + persist immediately. We default
 * to subscribing to every event Crowded fires that we care about; the
 * dispatcher silently ignores ones we don't handle yet.
 */
export async function registerWebhook(
  apiToken: string,
  input: {
    url: string;
    events?: string[];
    deliveryMode?: "at_least_once";
  },
  idempotencyKey?: string,
): Promise<CrowdedWebhookRegistration> {
  return crowdedFetch<CrowdedWebhookRegistration>(apiToken, "/api/v1/webhooks", {
    method: "POST",
    body: {
      url: input.url,
      events:
        input.events ??
        [
          "collect.payment.succeeded",
          "collect.payment.processing",
          "collect.payment.failed",
          "collect.payment.refunded",
          "collect.payment_plan.created",
          "collect.payment_plan.completed",
          "collect.payment_plan.canceled",
          "collect.refund.created",
        ],
      deliveryMode: input.deliveryMode ?? "at_least_once",
    },
    idempotencyKey: idempotencyKey ?? randomUUID(),
  });
}

/**
 * Delete a webhook registration — used on disconnect / re-register.
 */
export async function deleteWebhook(apiToken: string, webhookId: string): Promise<void> {
  await crowdedFetch<unknown>(apiToken, `/api/v1/webhooks/${webhookId}`, {
    method: "DELETE",
  });
}
