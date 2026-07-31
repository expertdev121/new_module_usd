/**
 * Typed REST wrapper for the ConnectionPoint (FundRazr) partner API.
 *
 * Auth: bearer token. Read from FUNDRAZR_API_KEY server env var. If the
 * partner uses OAuth 2.0 client_credentials in future, layer a token
 * cache + refresh helper here without changing the call sites.
 *
 * Read-only: this module deliberately exports only GET helpers. Adding
 * a POST/PUT/PATCH/DELETE helper here should be a conscious decision
 * with product sign-off.
 *
 * Errors: any non-2xx throws a FundrazrApiError with parsed body,
 * HTTP status, and an isAuthError flag so callers can decide whether
 * to reprompt for credentials.
 */

const API_BASE =
  process.env.FUNDRAZR_API_BASE_URL ?? "https://api.connectionpoint.com";

// ─── Types (only the fields we depend on; API sends more, we tolerate) ─────

export interface FundrazrOrganization {
  id: string;
  name?: string;
  url?: string;
  logo_url?: string;
  status?: string;
  created?: number;
  modified?: number;
}

export interface FundrazrCampaign {
  id: string;
  title?: string;
  url?: string;
  image_url?: string;
  goal?: number;
  currency?: string;
  status?: string;
  campaign_type?: string;
  parent_campaign_id?: string | null;
  organization_id?: string;
  created?: number;
  modified?: number;
  launched?: number;
  stats?: {
    total_raised?: number;
    contribution_count?: number;
  };
}

export interface FundrazrListPage<T> {
  entries: T[];
  after_cursor?: string | null;
  /** Total-count field is not always present; caller must not depend on it. */
  total?: number;
}

// ─── Error type ────────────────────────────────────────────────────────────

export class FundrazrApiError extends Error {
  status: number;
  body: unknown;
  isAuthError: boolean;
  isConfigError: boolean;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "FundrazrApiError";
    this.status = status;
    this.body = body;
    this.isAuthError = status === 401 || status === 403;
    this.isConfigError = status === 0; // client-side error (missing env, etc.)
  }
}

// ─── Low-level fetch ───────────────────────────────────────────────────────

interface RequestOpts {
  query?: Record<string, string | number | undefined | null>;
}

async function fundrazrGet<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const key = process.env.FUNDRAZR_API_KEY;
  if (!key) {
    throw new FundrazrApiError(
      "FUNDRAZR_API_KEY is not set on the server. Ask a super-admin to add it in Vercel env.",
      0,
      null,
    );
  }

  const url = new URL(`${API_BASE}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
    // ConnectionPoint has a 1,000 req/hr partner budget; we cache on our
    // side per-request so the same page load doesn't double-fetch. Longer
    // caching happens at the route level via Cache-Control on the response.
    cache: "no-store",
  });

  if (!response.ok) {
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = await response.text().catch(() => "");
    }
    throw new FundrazrApiError(
      `FundRazr GET ${path} → HTTP ${response.status}`,
      response.status,
      parsed,
    );
  }
  return (await response.json()) as T;
}

// ─── Public API surface (READ-ONLY) ────────────────────────────────────────

/**
 * List every campaign belonging to a ConnectionPoint organization.
 * Walks all cursor pages so the caller gets the complete set in one
 * array. For very large orgs (thousands of campaigns), swap to a
 * page-at-a-time helper.
 */
export async function listCampaignsForOrganization(
  organizationId: string,
  opts: { status?: string; type?: string } = {},
): Promise<FundrazrCampaign[]> {
  const all: FundrazrCampaign[] = [];
  let cursor: string | null | undefined = undefined;
  // Hard cap to protect the rate-limit budget from an unbounded org.
  const MAX_PAGES = 50;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: FundrazrListPage<FundrazrCampaign> = await fundrazrGet<FundrazrListPage<FundrazrCampaign>>(
      "/v1/campaigns",
      {
        query: {
          organization: organizationId,
          status: opts.status,
          type: opts.type,
          limit: 50,
          after: cursor ?? undefined,
        },
      },
    );
    all.push(...(res.entries ?? []));
    cursor = res.after_cursor ?? null;
    if (!cursor) break;
  }
  return all;
}

/**
 * Look up a single campaign — used for the drill-down view.
 */
export async function getCampaign(campaignId: string): Promise<FundrazrCampaign> {
  return fundrazrGet<FundrazrCampaign>(`/v1/campaigns/${campaignId}`);
}

/**
 * List sub-campaigns of a parent campaign.
 */
export async function listSubcampaigns(
  campaignId: string,
): Promise<FundrazrCampaign[]> {
  const all: FundrazrCampaign[] = [];
  let cursor: string | null | undefined = undefined;
  const MAX_PAGES = 20;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: FundrazrListPage<FundrazrCampaign> = await fundrazrGet<FundrazrListPage<FundrazrCampaign>>(
      `/v1/campaigns/${campaignId}/subcampaigns`,
      { query: { limit: 50, after: cursor ?? undefined } },
    );
    all.push(...(res.entries ?? []));
    cursor = res.after_cursor ?? null;
    if (!cursor) break;
  }
  return all;
}

/**
 * Look up an organization by id — used to auto-populate the display
 * label at connect time so the settings row shows the org's real name,
 * not just its opaque id.
 */
export async function getOrganization(
  organizationId: string,
): Promise<FundrazrOrganization> {
  return fundrazrGet<FundrazrOrganization>(`/v1/organizations/${organizationId}`);
}
