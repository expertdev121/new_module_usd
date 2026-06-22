# Crowded Forms Integration — Implementation Plan (v1)

**App:** donorHQ / GiveSuite (Next.js 16 App Router, Drizzle + Postgres, NextAuth)
**Goal:** Let each admin connect their own Crowded account, create payment/donation forms, embed them anywhere, and have completed payments sync automatically back into donorHQ — scoped per admin by `locationId`.

**v1 scope (your choices):** Inline embedded checkout · Recurring/payment-plan support · Synced donations mapped to a donorHQ campaign + category.

> This plan is written to use **only documented Crowded endpoints**. Anything not in the docs is listed in §4 as a dependency to confirm with Crowded — it is not assumed.

---

## 1. Design principles (follow existing donorHQ conventions)

These come straight from how the GoHighLevel (GHL) integration was built, and we mirror them exactly:

1. **Never modify `lib/db/schema.ts`.** Add a new `lib/db/schema-crowded.ts` plus numbered SQL migrations — same pattern as `schema-oauth.ts` / `schema-webhook.ts`.
2. **Tenant key is `locationId`**, not user id. Each admin = one `user` row with a `locationId`; every Crowded row (connection, form, donation) carries that `locationId`. A location can have multiple users, so we never key on `admin_id`.
3. **Reuse `manual_donation` + link to a `contact`.** Synced payments become `manual_donation` rows (exactly where GHL payments land), so they appear in every existing dashboard/report. We do **not** create a parallel flat donations table.
4. **Idempotent webhook ingestion** via an event store + partial unique index + `ON CONFLICT DO UPDATE`, mirroring `manual_donation_ghl_location_unique` and `ghl_webhook_events`.
5. **Tokens/secrets are server-only**, encrypted at rest, stripped from every API response (the connections API already does this).
6. **Webhook receiver under `/api/webhook/...`** so it inherits the existing middleware public-route exclusion (the GHL receiver is `/api/webhook/marketplace`).

---

## 2. Confirmed Crowded endpoints we will use

| Purpose | Method / Path | Notes |
|---|---|---|
| Validate token + list chapters | `GET /api/v1/chapters` | Used on connect to verify the API key and let the admin pick a chapter. |
| Create form | `POST /api/v1/chapters/:chapterId/collections` | `title` (≤50), `requestedAmount` cents min 100 (omit for donation), `goalAmount`, `recurringPaymentsEnabled`. Returns `collectionId`. |
| Create payment | `POST /api/v1/chapters/:chapterId/collections/:collectionId/intents` | Requires `requestedAmount` (cents min 100), `payerIp`, `userConsented:true`; `firstName/lastName/email` unless `contactId`; optional `mobile`, `successUrl`/`failureUrl` (placeholders), `paymentPlan{type,timeInterval,paymentsCount}`. Returns **`paymentUrl`**. Idempotent per contact. |
| Inline widget auth | `POST /api/v1/chapters/:chapterId/contacts/:contactId/embedded-token` | Returns short-lived `accessToken` for embedding Crowded UI. **SDK not named — see §4.** |
| Register webhook | `POST /api/v1/webhooks` | `url`, `events:["collect.payment.*","collect.payment_plan.*","collect.refund.*"]`, `deliveryMode:"at_least_once"`. Returns `secret` **once** — store encrypted. |
| Manage webhook | `GET/PATCH/DELETE /api/v1/webhooks/:id`, `GET /api/v1/webhooks/event-types` | Lifecycle + disconnect. |
| (Sandbox tests) | `POST /api/v1/sandbox/card-purchases`, `/card-authorizations` | Drive events deterministically in non-prod. |

Webhook delivery (documented): **batched** envelope `{batchId, count, events[]}`, header `X-Webhook-Signature: sha256=<HMAC-SHA256>`, per-event `eventId` for idempotency, `context.{partnerId,organizationId,chapterId}` on every event. Amounts in **cents**; payment event `amount` is **net (what the org receives)**, with a separate `fee`. Crowded is **USD-only**.

---

## 3. Webhook events we subscribe to & handle

- `collect.payment.succeeded` → create/update a `manual_donation` (primary path).
- `collect.payment.refunded` → set donation `paymentStatus = refunded` (or record partial via `refundDetailId`).
- `collect.payment.failed` → record/skip (optional status row; no donation).
- `collect.payment_plan.created` / `.completed` / `.canceled` → maintain a `crowded_payment_plans` row (recurring).
- `collect.refund.*`, `collect.intent.*`, `collect.collection.*` → optional, for status display only.

---

## 4. Open dependencies — confirm with Crowded before/with build (NOT assumed)

1. **Partner API token provenance & lifecycle.** How an admin obtains their token, whether it expires, and any refresh. We treat it as a long-lived dashboard-issued key, validated on save and re-checked on 401 (→ `needs_reconnect`).
2. **Embedded UI SDK.** The docs confirm `embedded-token` feeds "Crowded UI components" but never name the JS package/CDN/init API. **Blocks the inline widget only.** Mitigation in §11.
3. **Refund POST endpoint.** Only `refund-check` is documented. v1 *records* refunds from webhooks; *initiating* a refund from donorHQ waits on this.
4. **Webhook signature input.** Docs contradict themselves: prose says HMAC the *raw body*; the JS sample HMACs `JSON.stringify(payload)`. Resolve by testing in sandbox (donorHQ's GHL/Payroc verifiers use the raw body).
5. **Donation amount source for receipts** (gross vs net) — see §9. One finance decision to confirm.
6. **Partner ↔ admin mapping.** "Different accounts" implies each admin is a separate Crowded partner with its own token + webhook registration + secret. Confirm one partner may register the shared donorHQ webhook URL (docs allow one webhook *per URL per partner*).

---

## 5. Schema changes

New file **`lib/db/schema-crowded.ts`** + migrations `0026`–`0028`. Nothing in `schema.ts` changes.

### 5.1 `crowded_connections` (one per admin/location) — migration 0026
Mirrors `ghl_oauth_tokens`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `location_id` | text **unique** notNull | tenant key (= `user.location_id`) |
| `api_token_enc` | text notNull | Crowded partner key, **encrypted** |
| `org_id` | varchar(255) | from Crowded |
| `chapter_id` | varchar(255) notNull | selected chapter |
| `chapter_name` | varchar(255) | display |
| `webhook_registration_id` | varchar(255) | from `POST /webhooks` |
| `webhook_secret_enc` | text | **encrypted**; returned once |
| `status` | varchar(50) default `active` | `active` / `needs_reconnect` / `revoked` |
| `last_validated_at`, `revoked_at`, `created_at`, `updated_at` | timestamptz | |
| `created_by` | integer → `user.id` | |

### 5.2 `crowded_forms` — migration 0026

| Column | Type | Notes |
|---|---|---|
| `id` | serial pk | |
| `location_id` | text notNull | tenant key |
| `chapter_id` | varchar(255) notNull | |
| `crowded_collection_id` | varchar(255) notNull | from create-collection |
| `name` | text notNull | |
| `type` | varchar(20) notNull | `dues` (fixed) / `donation` (open) |
| `amount_cents` | integer | required for `dues` |
| `goal_cents` | integer | optional display |
| `recurring_enabled` | boolean default false | |
| `campaign_id` | integer → `campaign.id` | **mapping** |
| `category_id` | integer → `category.id` | **mapping** |
| `category_item_id` | integer → `category_item.id` | optional |
| `account_id` | integer → `account.id` | optional |
| `success_url`, `failure_url` | text | optional overrides |
| `is_active` | boolean default true | |
| `created_by`, `created_at`, `updated_at` | | |
| unique index | `(location_id, crowded_collection_id)` | |

### 5.3 Extend `manual_donation` — migration 0027 (ALTER only)
Parallels the GHL columns from 0025. `location_id` already exists.

```sql
ALTER TABLE manual_donation
  ADD COLUMN IF NOT EXISTS crowded_source         VARCHAR(50),   -- 'crowded_payment'
  ADD COLUMN IF NOT EXISTS crowded_resource_id    VARCHAR(255),  -- = Crowded paymentId (dedup)
  ADD COLUMN IF NOT EXISTS crowded_form_id        INTEGER,       -- → crowded_forms.id
  ADD COLUMN IF NOT EXISTS crowded_payment_method VARCHAR(50),   -- card / ach / ...
  ADD COLUMN IF NOT EXISTS crowded_fee_cents      INTEGER;       -- processor fee

CREATE UNIQUE INDEX IF NOT EXISTS manual_donation_crowded_location_unique
  ON manual_donation (location_id, crowded_resource_id)
  WHERE location_id IS NOT NULL AND crowded_resource_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_manual_donation_crowded_source
  ON manual_donation (crowded_source);
```

### 5.4 `crowded_webhook_events` (dedup + forensics) — migration 0026
Mirrors `ghl_webhook_events`: `id uuid`, `event_id` **unique**, `batch_id`, `event_type`, `chapter_id`, `location_id`, `payload jsonb`, `signature_valid bool`, `processing_status` (`received`/`processed`/`failed`/`skipped`), `processing_error`, `received_at`, `processed_at`.

### 5.5 `crowded_payment_plans` (recurring) — migration 0026
`id`, `location_id`, `crowded_plan_id` **unique**, `crowded_form_id`, `contact_id`, `type` (`recurring`/`installment`), `frequency`, `total_payments` (nullable), `completed_payments`, `total_paid_cents`, `status` (`active`/`canceled`/`completed`), `first_payment_date`, timestamps.

### 5.6 (Optional) `contact.crowded_contact_id` — migration 0028
ALTER `contact` to add `crowded_contact_id varchar(255)` + partial unique `(crowded_contact_id, location_id)`, mirroring `ghl_contact_id`. Improves match precision; if skipped, we match by email/mobile within `location_id`.

---

## 6. Field mapping: Crowded `collect.payment.succeeded` → `manual_donation`

| Crowded event field | donorHQ column |
|---|---|
| `data.paymentId` | `crowded_resource_id` (dedup) + `reference_number` |
| `data.contactId` | resolve → `contact_id` (match by `crowded_contact_id`/email/mobile within `location_id`, else create) |
| `data.collectionId` | → `crowded_forms` → `crowded_form_id`, `campaign_id`, `category_id`, `category_item_id`, `account_id` |
| `data.amount` (net) + `data.fee` | `amount` = gift (see §9); `crowded_fee_cents` = `fee` (÷100 into `numeric` for `amount`/`amount_usd`) |
| `data.method` | `crowded_payment_method` + `payment_method` (display) |
| currency | `USD` (+ `amount_usd`, `exchange_rate=1`) |
| `data.status` | `paymentStatus`: succeeded→`completed`, refunded→`refunded`, failed→`failed` |
| `event.timestamp` | `payment_date` / `received_date` |
| `data.plan.*` | upsert `crowded_payment_plans` |
| `crowded_source` | constant `'crowded_payment'` |
| `location_id` | from connection (via `context.chapterId`) |

Dedup write: `db.insert(manualDonation).values({...}).onConflictDoUpdate({ target: [manualDonation.locationId, manualDonation.crowdedResourceId], set: {...} })` — same shape as `payment-events.ts`.

---

## 7. Backend modules (`lib/crowded/`, mirroring `lib/ghl/`)

- `api-client.ts` — typed Crowded REST wrapper (bearer auth + per-write idempotency keys): `getChapters`, `createCollection`, `createIntent`, `createEmbeddedToken`, `registerWebhook`, `deleteWebhook`.
- `connection-storage.ts` — CRUD for `crowded_connections`; `getConnectionForLocation(locationId)`, `getConnectionByChapterId(chapterId)`; encrypt/decrypt token + secret.
- `crypto.ts` — AES-GCM encryption at rest keyed by an env secret (`CROWDED_ENC_KEY`).
- `webhook-signature.ts` — `verifySignature(rawBody, header, secret)` (test raw-vs-stringify per §4).
- `webhook-handlers/index.ts` — `dispatchEvent(event, locationId)` switch on `eventType`.
- `webhook-handlers/payment-succeeded.ts`, `payment-refunded.ts`, `payment-plan.ts`.
- `contact-match.ts` — match/create `contact` within `location_id` (reuse the `upsertContactFromWebhook` approach).
- `donation-upsert.ts` — the `manual_donation` ON CONFLICT writer.

---

## 8. API routes

**Admin (auth: role `admin`/`super_admin`, scoped by `session.user.locationId`):**

- `POST /api/admin/crowded/connect` — validate token via `GET /chapters`; store encrypted connection; register webhook; store secret.
- `GET /api/admin/crowded/chapters` — proxy `GET /chapters` for the connect picker.
- `GET /api/admin/crowded/connection` — sanitized status (no token/secret).
- `POST /api/admin/crowded/disconnect` — soft-revoke + `DELETE /webhooks/:id`.
- `POST /api/admin/crowded/forms` · `GET` list · `GET/PATCH/DELETE /api/admin/crowded/forms/[id]` — create collection + persist form (with campaign/category mapping).
- `GET /api/admin/crowded/forms/[id]/embed` — return the embed snippet.

**Public (no session — must be excluded in middleware, see §10):**

- `GET /donate/[formId]` — hosted donor page.
- `POST /api/public/crowded/forms/[formId]/intent` — server reads `payerIp` from request headers, calls `createIntent`, returns `{ paymentUrl, embeddedToken? }`.

**Webhook (public via `/api/webhook/...` prefix):**

- `POST /api/webhook/crowded` — verify signature → record each event in `crowded_webhook_events` (dedup by `eventId`) → `dispatchEvent`. Returns `2xx` fast; heavy work via `after()` like the GHL marketplace route.

---

## 9. Amount / fee handling (decision to confirm — §4.5)

Crowded's payment `amount` is **net** (org receives), with a separate `fee`. For receipting, the donor's **gift** is what matters. Recommended default:

- Store `amount` (the donation/gift) = the donor's chosen amount. When the donor **covers fees**, net already equals the gift, so use `amount`. When the **org absorbs fees**, the gift is `amount + fee`.
- Always store `crowded_fee_cents = fee` for finance reconciliation.
- If exact gift accuracy is required, correlate `payment.intentId` → the intent's `requestedAmount`.

Confirm the org's fee model with the customer so receipts show the intended figure.

---

## 10. Multi-tenancy & security

- Every query filters by `session.user.locationId` (admin) / the resolved `location_id` (webhook). The webhook maps `context.chapterId` → `crowded_connections` → `location_id`; **unknown chapters are rejected** (return 2xx, mark `skipped`).
- Per-connection webhook **secret**; verify HMAC on the **raw body before parsing**.
- API token + webhook secret **encrypted at rest**, **write-only** in the UI, never returned (the connections API already strips secrets).
- The admin enters their *own* Crowded token in the connect form (their action). Validate it immediately via `GET /chapters`.
- **Middleware:** add `donate` (page) and `api/public` (intent API) to the negative-lookahead matcher in `middleware.ts`. `/api/webhook/crowded` is already covered by the existing `api/webhook` exclusion.

---

## 11. Inline embedded checkout (your choice) + redirect fallback

The donor page (`/donate/[formId]`) collects name/email, amount (donation type), and a consent checkbox, then:

1. `POST /api/public/crowded/forms/[formId]/intent` → backend creates the intent (with `payerIp`, `userConsented`, and `paymentPlan` if recurring) and, for inline, also calls `embedded-token` server-side.
2. **Inline path:** mount Crowded's widget into a dedicated container using the `accessToken`. ⚠️ The widget SDK (package/CDN/init API) is **undocumented** — isolate it behind one `mountCrowdedWidget(token, container)` adapter so it's the only thing that changes once Crowded provides SDK docs.
3. **Redirect fallback (works today):** if the SDK isn't available, redirect the donor to the returned `paymentUrl` (Crowded-hosted page). `successUrl`/`failureUrl` point back to donorHQ thank-you pages.

Ship with the fallback enabled so the feature is functional before the SDK arrives; flip to inline once unblocked. **Always create the intent on the donor's submit action — never on page load** (avoids orphan intents/contacts and rate-limit waste; limit is 1000 req/min).

---

## 12. End-to-end flows

**Connect:** Admin → Settings → Connect Crowded → paste token → `GET /chapters` validates → pick chapter → store encrypted connection → auto-register webhook → store secret.

**Create form:** Admin → New Form (name, type, amount/goal, recurring, campaign+category) → `POST /collections` → save `crowded_forms` row → show embed snippet.

**Donate:** Visitor opens embed → enters details + consent → backend creates intent → inline widget (or redirect to `paymentUrl`) → pays on Crowded.

**Sync:** Crowded → `POST /api/webhook/crowded` (batched) → verify sig → dedup per `eventId` → resolve `location_id` via `chapterId` → match/create contact → upsert `manual_donation` (mapped campaign/category) → appears in existing dashboards/reports.

**Recurring:** `payment_plan.created` → `crowded_payment_plans` row; each cycle's `payment.succeeded` → its own `manual_donation` (deduped by `paymentId`); `.completed`/`.canceled` update plan status.

**Refund:** `payment.refunded` → set donation `paymentStatus=refunded` (partial via `refundDetailId`). Initiating refunds from donorHQ deferred to §4.3.

---

## 13. Testing

- **Sandbox events:** drive `collect.payment.succeeded` end-to-end via the documented sandbox endpoints; verify a `manual_donation` lands with correct contact, amount, campaign/category.
- **Signature:** valid/invalid HMAC → 2xx vs 401; settle the raw-body-vs-stringify question here.
- **Idempotency:** redeliver the same `eventId` and a duplicate `paymentId` → exactly one donation row.
- **Batches:** multi-event batch → each processed independently.
- **Multi-tenant isolation:** two locations' forms/payments never cross; unknown `chapterId` rejected.
- **Recurring:** plan lifecycle + multiple cycle payments.
- Use Playwright (already in the repo) for the connect/create-form/donate flows.

---

## 14. Phased delivery checklist

- [ ] **P0 — Confirm §4 with Crowded** (token issuance, embed SDK, refund endpoint, signature input, fee model, partner mapping).
- [ ] **P1 — Schema:** `schema-crowded.ts` + migrations 0026–0028; run on a branch DB.
- [ ] **P2 — Connection:** `lib/crowded/api-client`, `connection-storage`, `crypto`; connect/disconnect routes + Settings UI; webhook auto-registration.
- [ ] **P3 — Forms:** create-collection route + form CRUD + admin UI (list, embed snippet, campaign/category mapping).
- [ ] **P4 — Webhook sync (one-time):** `/api/webhook/crowded`, signature verify, event store, contact match, donation upsert; sandbox-tested.
- [ ] **P5 — Public donate page + intent (redirect fallback live).**
- [ ] **P6 — Inline embedded widget** (once SDK docs received).
- [ ] **P7 — Recurring** (`crowded_payment_plans` + plan events) **& refund recording.**
- [ ] **P8 — Hardening:** idempotency, multi-tenant, rate-limit, audit-log entries, Playwright E2E.

---

*Plan is read-only/no code changes. Build starts only after P0 sign-off on the §4 items.*
