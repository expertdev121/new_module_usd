/**
 * An in-memory stand-in for QuickBooks Online, for tests. It speaks just enough of the OAuth token
 * endpoint and the accounting API for DonorHQ's client: rotating refresh tokens, paged queries,
 * Deposit / JournalEntry creation with request-id idempotency, and switchable failures.
 * It is NOT proof that real QuickBooks accepts DonorHQ's payloads; that needs a sandbox company.
 */
import type { Fetch } from "./client";

export interface FakeAccount { Id: string; Name: string; FullyQualifiedName: string; AcctNum?: string; AccountType: string; Active: boolean }
export interface FakeClass { Id: string; Name: string; FullyQualifiedName: string; Active: boolean }
export interface FakeEntry { entity: "Deposit" | "JournalEntry"; Id: string; body: Record<string, unknown>; requestId: string | null }

export class FakeQbo {
  accounts: FakeAccount[] = [];
  classes: FakeClass[] = [];
  entries: FakeEntry[] = [];
  validRefreshToken = "refresh-1";
  validAccessToken = "access-1";
  companyName = "Test Synagogue Inc";
  calls: string[] = [];
  revoked: string[] = [];
  /** DocNumber -> error message: the create call fails with a QuickBooks Fault. */
  failDocs = new Map<string, string>();
  /** Respond 429 to this many create calls before succeeding. */
  rateLimitCreates = 0;
  /** Respond 401 to every API call (revoked token). */
  apiUnauthorized = false;
  /** Make the next token refresh fail like a revoked refresh token. */
  refreshInvalid = false;
  private n = 100;
  private seen = new Map<string, Response>();

  addAccount(a: Partial<FakeAccount> & { Name: string }): FakeAccount {
    const full: FakeAccount = { Id: String(++this.n), FullyQualifiedName: a.Name, AccountType: "Income", Active: true, ...a };
    this.accounts.push(full);
    return full;
  }
  addClass(name: string, active = true): FakeClass {
    const c = { Id: String(++this.n), Name: name, FullyQualifiedName: name, Active: active };
    this.classes.push(c);
    return c;
  }
  creates() {
    return this.entries.length;
  }

  fetch: Fetch = async (input, init) => {
    const url = new URL(input);
    const method = init?.method ?? "GET";
    this.calls.push(`${method} ${url.pathname}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", intuit_tid: "tid-fake" } });
    const fault = (status: number, message: string, detail?: string) => json(status, { Fault: { Error: [{ Message: message, Detail: detail }], type: "ValidationFault" } });

    if (url.hostname === "oauth.platform.intuit.com") {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const grant = form.get("grant_type");
      if (grant === "authorization_code") {
        if (form.get("code") !== "good-code") return json(400, { error: "invalid_grant" });
      } else if (grant === "refresh_token") {
        if (this.refreshInvalid || form.get("refresh_token") !== this.validRefreshToken) return json(400, { error: "invalid_grant" });
      } else return json(400, { error: "unsupported_grant_type" });
      const next = Number(this.validRefreshToken.split("-")[1] ?? "1") + 1;
      this.validRefreshToken = `refresh-${next}`;
      this.validAccessToken = `access-${next}`;
      return json(200, { access_token: this.validAccessToken, refresh_token: this.validRefreshToken, expires_in: 3600, x_refresh_token_expires_in: 8640000 });
    }
    if (url.hostname === "developer.api.intuit.com") {
      this.revoked.push(JSON.parse(String(init?.body ?? "{}")).token);
      return json(200, {});
    }

    // Accounting API
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    if (this.apiUnauthorized || auth !== `Bearer ${this.validAccessToken}`) return json(401, { fault: { error: [{ message: "AuthenticationFailed" }] } });
    const path = url.pathname.replace(/^\/v3\/company\/[^/]+\//, "");

    if (path.startsWith("companyinfo/")) return json(200, { CompanyInfo: { CompanyName: this.companyName } });

    if (path === "query") {
      const q = url.searchParams.get("query") ?? "";
      const page = /startposition (\d+) maxresults (\d+)/.exec(q);
      const start = page ? Number(page[1]) - 1 : 0;
      const max = page ? Number(page[2]) : 1000;
      if (/from Account/.test(q)) return json(200, { QueryResponse: { Account: this.accounts.slice(start, start + max) } });
      if (/from Class/.test(q)) return json(200, { QueryResponse: { Class: this.classes.slice(start, start + max) } });
      const doc = /from JournalEntry where DocNumber = '([^']+)'/.exec(q);
      if (doc) {
        const hit = this.entries.find((e) => e.entity === "JournalEntry" && e.body.DocNumber === doc[1]);
        return json(200, { QueryResponse: hit ? { JournalEntry: [{ Id: hit.Id }] } : {} });
      }
      // Real QuickBooks keeps no DocNumber on a Deposit; DonorHQ finds one by date + PrivateNote.
      const dep = /from Deposit where TxnDate = '([^']+)'/.exec(q);
      if (dep) {
        const hits = this.entries.filter((e) => e.entity === "Deposit" && e.body.TxnDate === dep[1]).map((e) => ({ Id: e.Id, PrivateNote: e.body.PrivateNote }));
        return json(200, { QueryResponse: hits.length ? { Deposit: hits } : {} });
      }
      return fault(400, "Unsupported query", q);
    }

    if (method === "POST" && (path === "deposit" || path === "journalentry")) {
      const entity = path === "deposit" ? "Deposit" : "JournalEntry";
      const requestId = url.searchParams.get("requestid");
      if (requestId && this.seen.has(requestId)) return this.seen.get(requestId)!.clone();
      if (this.rateLimitCreates > 0) {
        this.rateLimitCreates--;
        return json(429, { Fault: { Error: [{ Message: "Too many requests" }] } });
      }
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const failure = this.failDocs.get(String(body.DocNumber));
      if (entity === "Deposit") delete body.DocNumber; // real QuickBooks does not store it on a Deposit (after the failure lookup)
      if (failure) return fault(400, "Business Validation Error", failure);
      const refs = JSON.stringify(body);
      for (const m of refs.matchAll(/"AccountRef":\{"value":"([^"]+)"\}/g)) {
        const a = this.accounts.find((x) => x.Id === m[1]);
        if (!a) return fault(400, "Invalid Reference Id", `Accounts element id ${m[1]} is not valid.`);
        if (!a.Active) return fault(400, "Invalid Reference Id", `Account ${a.Name} is inactive.`);
      }
      const entry: FakeEntry = { entity, Id: String(++this.n), body, requestId };
      this.entries.push(entry);
      const res = json(200, { [entity]: { Id: entry.Id, ...body } });
      if (requestId) this.seen.set(requestId, res.clone());
      return res;
    }
    return fault(404, "Not found", path);
  };
}
