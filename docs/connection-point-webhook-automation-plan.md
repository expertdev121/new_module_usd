# Connection Point Webhook Self-Serve Registration — Plan

**Status:** Proposal — not yet implemented
**Owner:** GiveSuite / DonorHQ Team
**Last updated:** 2026-06-26
**Related:** [SOP: Connection Point Webhook v1.1](../../../Users/jhavi/Documents/SOP_Connection_Point_Webhook_v1.1.docx) · [app/api/webhook/ghl/donation/route.ts](../app/api/webhook/ghl/donation/route.ts)

---

## 1. Goal

Replace the dev-driven Connection Point webhook setup with a self-serve admin page. An operator should be able to:

1. See every organization under our Connection Point partner account.
2. Pick an org and paste the GHL inbound webhook URL they want to wire up.
3. Click **Register** — we register the URL with Connection Point on their behalf.
4. Click **Send Test Payload** — we fire a known-good Connection Point–shaped payload at the URL so the operator can verify GHL is receiving it.
5. Finish wiring the GHL workflow themselves (per the SOP).

No engineering involvement required.

---

## 2. What we automate vs. what the operator still does

| The tool does | The operator still does |
| --- | --- |
| Lists all orgs from Connection Point (auth + partner_id from env) | Browses the list, copies the `org_id` of the org to onboard |
| Registers the GHL inbound webhook URL with Connection Point for that `org_id` | Pastes the GHL inbound webhook URL into the form |
| Fires a known-good test payload at the GHL URL | Watches the GHL execution log to confirm the workflow fires |
| Shows success / failure with diagnostic detail | Finishes wiring the GHL workflow's custom-data fields (per SOP §5 Step 6) |

The GHL workflow itself stays manual — it's an in-GHL configuration job we can't drive from outside.

---

## 3. Env vars to add

```env
CONNECTION_POINT_API_BASE_URL=https://api.connectionpoint.org   # TBD — confirm
CONNECTION_POINT_BEARER_TOKEN=<long-lived token>
CONNECTION_POINT_PARTNER_ID=<partner id>
```

- All three read once at module load.
- Server-side only — **never** prefix with `NEXT_PUBLIC_`.
- Bearer token rotates: provision a process for the ops team to update it without a code deploy.

---

## 4. Admin UI

**Route:** `/admin/cp-webhook-registration`
**Auth:** `super_admin` only (mirrors how `/admin/*` is already protected in [middleware.ts](../middleware.ts) lines 36-38).

### 4.1 Organization picker (section 1)

- Server component fetches `GET ${CONNECTION_POINT_API_BASE_URL}/organizations?partner_id=…` at request time.
- Table columns: `org_id`, name, contact email, status, created date.
- Client-side search box.
- **Copy** button per row → copies `org_id` to clipboard.
- Sortable by name and created date.

### 4.2 Registration form (section 2)

- Inputs: `org_id` (text), `webhook_url` (text), event filter dropdown (default `payment.created`).
- Submit → server action → Connection Point register call → write audit row to `cp_webhook_registration`.
- On success: show the Connection Point–assigned webhook ID and the URL it points to.
- On failure: surface the Connection Point error verbatim.

### 4.3 Test delivery panel (section 3)

- Button: **Send Test Payload**.
- POSTs the canonical dummy payload (see §6) to the entered URL with `Content-Type: application/json`.
- Shows: response status, response body (first 2 KB), elapsed ms.
- Footnote: "Now check the GHL execution log for this workflow to confirm DonorHQ received the donation." (Our test only verifies the GHL inbound URL accepts the payload; full end-to-end visibility lives in GHL's execution log.)

---

## 5. API routes

All routes session-gated to `super_admin`. None are public webhooks.

| Route | Method | Purpose | Notes |
| --- | --- | --- | --- |
| `/api/connection-point/organizations` | GET | List orgs for the configured partner | 30s server-side cache to avoid Connection Point rate limits during search-as-you-type |
| `/api/connection-point/webhooks` | POST | Register `{org_id, webhook_url, events[]}` with Connection Point | Also writes an audit row |
| `/api/connection-point/webhooks?org_id=…` | GET | List webhooks already registered for an org | So operators can see existing config before adding more |
| `/api/connection-point/webhooks/:id` | DELETE | Remove a registration | For cleanup of misconfigured URLs |
| `/api/connection-point/test-payload` | POST | Fire the dummy payload to a given URL | No Connection Point call — direct POST from our server. Returns `{status, body, elapsedMs}` |

---

## 6. Test payload

The canonical dummy payload is the Connection Point `payment.created` shape used by the Primary Connection Point webhook. Stored as a constant in `lib/connection-point/test-payload.ts`.

```json
{
  "event": "payment.created",
  "entity_type": "organization",
  "entity_id": "4JMJ1",
  "data": {
    "created": 1782228334,
    "campaign_id": "e2iyZ4",
    "organization_id": "4JMJ1",
    "amount": 101,
    "net_amount": 94.74,
    "matched_amount": 0,
    "recovered_fees": 0,
    "currency": "usd",
    "status": "preapproved",
    "payer_name": "Orna beer",
    "payer_first_name": "Orna",
    "payer_last_name": "beer",
    "payer_email": "orpro1976@gmail.com",
    "transaction_id": "sub_1TlWCjFVb9BFQ9XAcgNvlgwr",
    "account": "stripe",
    "message": "For Parnassah Tova!",
    "contact_email": "orpro1976@gmail.com",
    "subscribe_to_updates": false,
    "payment_type": "subscription",
    "id": "7769331",
    "object": "payment"
  },
  "id": "3sC",
  "object": "webhook_event"
}
```

### 6.1 Per-request mutations before sending

```ts
const payload = structuredClone(DUMMY_PAYLOAD);
payload.entity_id            = orgId;
payload.data.organization_id = orgId;
payload.data.created         = Math.floor(Date.now() / 1000);
payload.data.transaction_id  = `test_${randomUUID()}`;  // unique per click
payload.id                   = randomUUID();
```

- `transaction_id` is randomized per click so DonorHQ's `(location_id, transaction_id)` dedup does not falsely report `DONATION_ALREADY_EXISTS` on the second test of the same URL.
- `entity_id` / `organization_id` are rewritten to the org the operator selected — keeps the test consistent with the real registration.
- `created` is current — keeps logs readable.

### 6.2 What we drop

The `headers` block from the raw Connection Point sample is **not** sent. Those are inbound metadata GHL synthesizes itself; forwarding them confuses the receiver.

---

## 7. Database additions

Single Drizzle migration:

```sql
CREATE TABLE cp_webhook_registration (
  id               SERIAL PRIMARY KEY,
  org_id           TEXT NOT NULL,
  webhook_url      TEXT NOT NULL,
  cp_webhook_id    TEXT,
  registered_by    INTEGER REFERENCES "user"(id),
  registered_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  status           TEXT NOT NULL DEFAULT 'active',  -- active | revoked | failed
  last_test_at     TIMESTAMP,
  last_test_status INTEGER,
  notes            TEXT
);

CREATE INDEX cp_webhook_registration_org_id_idx
  ON cp_webhook_registration (org_id);
```

Gives:
- Audit trail of who registered what, when.
- "This URL was last tested 5 minutes ago — 200 OK" indicator in the UI.
- A query path to revoke webhooks in bulk when a Connection Point partner relationship ends.

---

## 8. Connection Point API client

New module: `lib/connection-point/client.ts`

```ts
listOrganizations(params?: { search?: string; cursor?: string }): Promise<{ orgs: Org[]; nextCursor?: string }>;
registerWebhook(input: { orgId: string; url: string; events: string[] }): Promise<{ cpWebhookId: string }>;
listWebhooks(orgId: string): Promise<RegisteredWebhook[]>;
deleteWebhook(cpWebhookId: string): Promise<void>;
```

- Reads bearer token + partner ID from env at construction; throws on missing values.
- Wraps `fetch` with bearer header injection and JSON parsing.
- Surface Connection Point HTTP errors as structured exceptions (`ConnectionPointApiError` with `status`, `code`, `body`).
- Unit-testable in isolation — pass a `fetch` mock.

---

## 9. Open questions — blockers for implementation

Numbered so they can be answered inline.

1. **Connection Point API base URL and exact endpoint paths.** Plan assumes `/organizations` and `/webhooks` — what are they actually? Postman collection or OpenAPI spec preferred.
2. **Webhook registration request shape.** What does Connection Point's POST `/webhooks` accept — just `(org_id, url, events[])` or more (HMAC secret, filters, retry policy)? Does the response include a webhook ID we can store?
3. **Pagination on the org list.** If the partner has 500+ orgs, the picker needs pagination. Cursor or offset? What's the page-size limit?
4. **Per-org or partner-level webhooks?** Changes whether we register N webhooks (one per org) or one webhook at the partner level with org filters. The current plan assumes per-org.
5. **Authentication scheme.** Plan assumes `Authorization: Bearer <token>`. Confirm.
6. **Rate limits.** What's Connection Point's rate limit? Affects the org-list cache TTL.
7. **Token rotation.** Is the bearer long-lived (months) or short-lived (days)? Long-lived → env var is fine. Short-lived → we need a refresh flow.

---

## 10. Suggested build order

| Day | Deliverable |
| --- | --- |
| 1 | Env vars wired. `lib/connection-point/client.ts` implemented with all four methods. Unit tests with a fetch mock. |
| 2 | Drizzle migration for `cp_webhook_registration`. The 5 API routes wrapping the client. |
| 3 | Admin UI page: server component for org list + client component for the form and test panel. |
| 4 | Test payload constant + mutation helper. Polish, error states, in-page docs link to the SOP. Walkthrough with a non-dev operator. |

Total: ~4 dev days assuming the open questions in §9 are answered before Day 1 starts.

---

## 11. Out of scope (explicitly)

- Building or modifying the GHL workflow itself — that stays a manual GHL UI task per the SOP.
- Auto-publishing draft GHL workflows.
- Listening for delivery callbacks from Connection Point (their async retry signals). If we ever need that, it's a separate inbound webhook of our own.
- Migrating already-registered webhooks into the audit table retroactively — operator can re-register through the UI once if they want them tracked.
- Multi-partner support. Single `CONNECTION_POINT_PARTNER_ID` env var assumes one partner relationship. Adding a second partner is a future schema change.
