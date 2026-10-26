/**
 * Thin QuickBooks Online client: OAuth 2.0 (authorize, code exchange, refresh, revoke) and the
 * handful of accounting API calls DonorHQ needs. All network access goes through `http`, which
 * tests replace with a fake QuickBooks server.
 */
import { AUTH_URL, MINOR_VERSION, REVOKE_URL, SCOPE, TOKEN_URL, apiBase, qboConfig, type QboEnvironment } from "./config";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
let http: Fetch = (input, init) => fetch(input, init);
/** Test hook: route every QuickBooks call through a fake. */
export function setQboFetch(f: Fetch | null) {
  http = f ?? ((input, init) => fetch(input, init));
}

/** The connection can no longer be used (revoked, expired refresh token, wrong company). Needs a reconnect. */
export class QboAuthError extends Error {}
/** QuickBooks refused or failed a request; message is already in plain words. */
export class QboApiError extends Error {
  constructor(message: string, public status: number, public intuitTid: string | null = null) {
    super(message);
  }
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

const basicAuth = () => {
  const { clientId, clientSecret } = qboConfig();
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
};

export function buildAuthUrl(state: string): string {
  const { clientId, redirectUri } = qboConfig();
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", scope: SCOPE, redirect_uri: redirectUri, state });
  return `${AUTH_URL}?${q}`;
}

async function tokenRequest(form: Record<string, string>): Promise<TokenSet> {
  const res = await http(TOKEN_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(data.error ?? res.status);
    if (res.status === 400 || res.status === 401) throw new QboAuthError(`QuickBooks rejected the sign-in (${err}). Reconnect QuickBooks.`);
    throw new QboApiError(`QuickBooks sign-in failed (${err}).`, res.status);
  }
  const now = Date.now();
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string") throw new QboApiError("QuickBooks returned an unexpected sign-in response.", 502);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessExpiresAt: new Date(now + Number(data.expires_in ?? 3600) * 1000),
    refreshExpiresAt: new Date(now + Number(data.x_refresh_token_expires_in ?? 8640000) * 1000),
  };
}

export const exchangeCode = (code: string) =>
  tokenRequest({ grant_type: "authorization_code", code, redirect_uri: qboConfig().redirectUri });

/** QuickBooks rotates the refresh token: the new one must be stored, the old one retired. */
export const refreshTokens = (refreshToken: string) => tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });

export async function revokeToken(token: string): Promise<void> {
  await http(REVOKE_URL, {
    method: "POST",
    headers: { Authorization: basicAuth(), "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token }),
  });
}

/** Turns a QuickBooks Fault body into one plain sentence. */
export function faultMessage(body: unknown): string | null {
  const fault = (body as { Fault?: { Error?: Array<{ Message?: string; Detail?: string }> } } | null)?.Fault;
  const e = fault?.Error?.[0];
  if (!e) return null;
  return [e.Message, e.Detail].filter(Boolean).join(": ").slice(0, 400);
}

export interface RequestOptions {
  env: QboEnvironment;
  realmId: string;
  accessToken: string;
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string>;
  body?: unknown;
  /** Makes a POST safe to retry: QuickBooks returns the original result for a repeated id. */
  requestId?: string;
}

const RETRYABLE = new Set([429, 502, 503, 504]);

export async function qboRequest<T = Record<string, unknown>>(o: RequestOptions): Promise<T> {
  const q = new URLSearchParams({ minorversion: MINOR_VERSION, ...(o.query ?? {}) });
  if (o.requestId) q.set("requestid", o.requestId);
  const url = `${apiBase(o.env)}/v3/company/${encodeURIComponent(o.realmId)}/${o.path}?${q}`;
  const method = o.method ?? "GET";
  const canRetry = method === "GET" || Boolean(o.requestId);

  for (let attempt = 0; ; attempt++) {
    const res = await http(url, {
      method,
      headers: { Authorization: `Bearer ${o.accessToken}`, Accept: "application/json", ...(o.body ? { "Content-Type": "application/json" } : {}) },
      body: o.body ? JSON.stringify(o.body) : undefined,
    });
    const tid = res.headers.get("intuit_tid");
    if (res.ok) return (await res.json()) as T;
    if (canRetry && attempt < 2 && RETRYABLE.has(res.status)) {
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }
    const body = await res.json().catch(() => null);
    if (res.status === 401) throw new QboAuthError("QuickBooks no longer accepts this connection. Reconnect QuickBooks.");
    const msg = faultMessage(body) ?? `QuickBooks returned an error (${res.status}).`;
    throw new QboApiError(msg, res.status, tid);
  }
}

type Base = Pick<RequestOptions, "env" | "realmId" | "accessToken">;

export async function companyName(b: Base): Promise<string | null> {
  const r = await qboRequest<{ CompanyInfo?: { CompanyName?: string } }>({ ...b, path: `companyinfo/${encodeURIComponent(b.realmId)}` });
  return r.CompanyInfo?.CompanyName ?? null;
}

/** Every row of an entity, active and inactive, 1000 at a time. */
export async function queryAll<T>(b: Base, entity: "Account" | "Class"): Promise<T[]> {
  const out: T[] = [];
  for (let start = 1; ; start += 1000) {
    const r = await qboRequest<{ QueryResponse?: Record<string, T[] | undefined> }>({
      ...b,
      path: "query",
      query: { query: `select * from ${entity} where Active in (true, false) startposition ${start} maxresults 1000` },
    });
    const page = r.QueryResponse?.[entity] ?? [];
    out.push(...page);
    if (page.length < 1000) return out;
  }
}
