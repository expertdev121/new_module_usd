# Domain Change Checklist

Use this document when migrating away from `https://new-module-usd.vercel.app/`.

---

## 1. Hardcoded `new-module-usd.vercel.app` Fallbacks

These files use the old domain as a **fallback** when environment variables are not set. After the domain change, make sure the correct env vars are set so the fallback is never hit — then optionally update the strings too.

| File | Line | Variable checked first | Fallback used for |
|------|------|------------------------|-------------------|
| [app/api/send-receipt/route.ts](../app/api/send-receipt/route.ts#L311) | 311 | `NEXT_PUBLIC_BASE_URL` (via `host` header) | Building the PDF receipt URL sent to GHL |
| [app/api/webhook/stripe/sync-payment.ts](../app/api/webhook/stripe/sync-payment.ts#L631) | 631 | `NEXT_PUBLIC_BASE_URL` (via `host` header) | Building the PDF receipt URL in Stripe webhook handler |
| [app/api/contacts/send-year-end-letters/route.ts](../app/api/contacts/send-year-end-letters/route.ts#L158) | 158 | `NEXT_PUBLIC_BASE_URL` | Building the year-end letter PDF URL sent to GHL |
| [scripts/integrity-checker.ts](../scripts/integrity-checker.ts#L267) | 267 | `NEXT_PUBLIC_APP_URL` then `NEXTAUTH_URL` | Fetching exchange rates inside the integrity checker script |

### Fix
Set these env vars in Vercel (and `.env`) to the new domain:
```
NEXT_PUBLIC_BASE_URL=https://your-new-domain.com
NEXT_PUBLIC_APP_URL=https://your-new-domain.com
NEXTAUTH_URL=https://your-new-domain.com
```

---

## 2. Inbound Webhook Endpoints (Routes YOUR app exposes)

These are the URLs that **external services (Stripe, Payroc, GHL, Fundrazr)** call into. When the domain changes you must update the registered webhook URL in each external service's dashboard.

| Route (path) | Full URL after domain change | Called by |
|---|---|---|
| `/webhook` | `https://new-domain.com/webhook` | GHL (forwards to `GHL_WEBHOOK_URL`) |
| `/api/webhook` | `https://new-domain.com/api/webhook` | Generic inbound |
| `/api/webhook/stripe/sync-payment` | `https://new-domain.com/api/webhook/stripe/sync-payment` | Stripe — update in Stripe Dashboard → Webhooks |
| `/api/webhook/payment` | `https://new-domain.com/api/webhook/payment` | Stripe payment events |
| `/api/webhook/sync-payment` | `https://new-domain.com/api/webhook/sync-payment` | Stripe sync (alternate) |
| `/api/webhook/contact` | `https://new-domain.com/api/webhook/contact` | GHL contact events |
| `/api/webhook/contact/delete` | `https://new-domain.com/api/webhook/contact/delete` | GHL contact deletion events |
| `/api/webhook/fundrazr/payment-sync` | `https://new-domain.com/api/webhook/fundrazr/payment-sync` | Fundrazr — update in Fundrazr settings |
| `/api/webhook/texas/contact_payment` | `https://new-domain.com/api/webhook/texas/contact_payment` | Texas-specific payment events |
| `/api/webhook/upgrade` | `https://new-domain.com/api/webhook/upgrade` | Upgrade/subscription events |
| `/api/manual-donations/webhook` | `https://new-domain.com/api/manual-donations/webhook` | Manual donation trigger |
| `/api/payroc/subscription` | `https://new-domain.com/api/payroc/subscription` | Payroc — update subscription webhook registration |

> **Payroc note:** The Payroc subscription webhook URL is currently hardcoded to a `webhook.site` test URL in [app/api/payroc/subscription/route.ts:14](../app/api/payroc/subscription/route.ts#L14) and the setup script uses an ngrok URL in [scripts/setup-webhook.ts:5](../scripts/setup-webhook.ts#L5). Both need to be updated to the new domain before going live.

---

## 3. Outbound Webhook URLs (URLs YOUR app calls out to)

These are **not** affected by your domain change — they are external services you send data to. Listed here for completeness.

### GHL / LeadConnector (`services.leadconnectorhq.com`)

| File | Line | Used for | Location ID |
|------|------|----------|-------------|
| [app/api/send-receipt/route.ts](../app/api/send-receipt/route.ts#L10) | 10 | Fallback receipt webhook | `G3mogWGU1gtYiOtHJwqy` |
| [app/api/send-receipt/route.ts](../app/api/send-receipt/route.ts#L94) | 94–112 | Per-location receipt webhooks | Multiple locations |
| [app/api/webhook/stripe/sync-payment.ts](../app/api/webhook/stripe/sync-payment.ts#L8) | 8 | Fallback receipt (Stripe handler) | `G3mogWGU1gtYiOtHJwqy` |
| [app/api/webhook/stripe/sync-payment.ts](../app/api/webhook/stripe/sync-payment.ts#L68) | 68–97 | Per-location receipt (Stripe handler) | Multiple locations |
| [app/api/webhook/payment/route.ts](../app/api/webhook/payment/route.ts#L8) | 8 | Receipt on payment event | `E7yO96aiKmYvsbU2tRzc` |
| [app/api/payments/route.ts](../app/api/payments/route.ts#L11) | 11 | Receipt on payment create | `E7yO96aiKmYvsbU2tRzc` |
| [app/api/manual-donations/route.ts](../app/api/manual-donations/route.ts#L14) | 14 | Receipt on manual donation | `E7yO96aiKmYvsbU2tRzc` |
| [app/api/manual-donations/webhook/route.ts](../app/api/manual-donations/webhook/route.ts#L7) | 7 | Manual donation data push | `4Nzcp3vUgVbOoN9uxu5F` |
| [app/api/pledges/route.ts](../app/api/pledges/route.ts#L178) | 178–182 | Pledge created (per location) | `E7yO96aiKmYvsbU2tRzc`, `g9JSoJ1FInnA6N0SHXi7`, `KVgMIrEYRkKRcfeicJBm` |
| [app/api/send-pledge/route.ts](../app/api/send-pledge/route.ts#L75) | 75–81 | Send pledge email (per location) | `E7yO96aiKmYvsbU2tRzc`, `g9JSoJ1FInnA6N0SHXi7`, `KVgMIrEYRkKRcfeicJBm`, `asI8eHkRqF8RpX1VXhHz` |
| [app/api/contacts/send-year-end-letters/route.ts](../app/api/contacts/send-year-end-letters/route.ts#L9) | 9 | Year-end letter delivery | `0lb5xbd0qHmaEqPUPc2N` |
| [app/chat/page.tsx](../app/chat/page.tsx#L5) | 5 | Chat escalation to GHL | `Q9ZvF3ohYiVfIHJFHED6` |
| [scripts/donation-object.ts](../scripts/donation-object.ts#L8) | 8 | Script: donation object push | `4Nzcp3vUgVbOoN9uxu5F` |

### n8n (`givesuite.app.n8n.cloud`)

| File | Line | Used for |
|------|------|----------|
| [lib/utils/send-n8n-manual-donation.ts](../lib/utils/send-n8n-manual-donation.ts#L5) | 5 | Manual donation webhook (test URL — `webhook-test/`) |
| [app/chat/page.tsx](../app/chat/page.tsx#L4) | 4 | Chat messages to n8n AI agent |

> **n8n note:** Line 5 of `send-n8n-manual-donation.ts` uses a **`webhook-test`** URL (not production). Confirm this is intentional before go-live.

### Payroc (`api.uat.payroc.com`)

| File | Line | Used for |
|------|------|----------|
| [app/api/payroc/route.ts](../app/api/payroc/route.ts#L13) | 13 | Payroc payments API (UAT) |
| [app/api/payroc/transactions/route.ts](../app/api/payroc/transactions/route.ts#L53) | 53 | Payroc transactions (UAT) |
| [app/api/payroc/token/route.ts](../app/api/payroc/token/route.ts#L9) | 9 | Payroc auth token (UAT) |
| [app/api/payroc/hosted-session/route.ts](../app/api/payroc/hosted-session/route.ts#L9) | 9 | Payroc hosted fields sessions (UAT) |
| [app/api/payroc/subscription/route.ts](../app/api/payroc/subscription/route.ts#L11) | 11 | Payroc event subscriptions (UAT) |
| [scripts/setup-webhook.ts](../scripts/setup-webhook.ts#L4) | 4 | Script: register Payroc webhook (UAT) |

> **Payroc UAT note:** All Payroc URLs point to `api.uat.payroc.com`. Confirm whether production (`api.payroc.com`) should be used after go-live.

### GHL via env var (not hardcoded)

| File | Env var | Used for |
|------|---------|----------|
| [app/webhook/route.ts](../app/webhook/route.ts#L223) | `GHL_WEBHOOK_URL` | Forwarding inbound GHL events |
| [lib/public-stripe-payments.ts](../lib/public-stripe-payments.ts#L165) | `GHL_WEBHOOK_URL` | Stripe public payment → GHL notification |

---

## 4. Pages on THIS App Embedded as Iframes Elsewhere

These are pages/routes **served by this app** that are embedded via `<iframe src="https://new-module-usd.vercel.app/...">` in GHL, email campaigns, or other external systems. **The embed `src` URLs live outside this codebase** (in GHL funnels, page builders, etc.) so you must hunt them down and update them there.

The pages themselves are fine — they use relative API paths and `window.location.origin` so no code changes are needed inside the files. Only the external embed codes need updating.

| Page / Path | File in this repo | Embedded as iframe in |
|---|---|---|
| `/chaplains-donation-form.html` | [public/chaplains-donation-form.html](../public/chaplains-donation-form.html) | GHL funnel / external website — find `<iframe src="https://new-module-usd.vercel.app/chaplains-donation-form.html"...>` |
| `/benchmark-adventure-ministries-form.html` | [public/benchmark-adventure-ministries-form.html](../public/benchmark-adventure-ministries-form.html) | GHL funnel / external website — find `<iframe src="https://new-module-usd.vercel.app/benchmark-adventure-ministries-form.html"...>` |
| `/chat` | [app/chat/page.tsx](../app/chat/page.tsx) | GHL funnel / external website — find `<iframe src="https://new-module-usd.vercel.app/chat"...>` |

> **Action required:** Search in GHL → Sites → Funnels, Pages, and any custom code blocks for `new-module-usd.vercel.app` and update those iframe `src` values to your new domain.

---

## 5. Other Hardcoded External URLs (not affected by domain change)

These are URLs pointing to other services — listed for completeness, no action needed for the domain change.

| File | Line | URL | Used for |
|------|------|-----|----------|
| [components/trial-access-guard.tsx](../components/trial-access-guard.tsx#L70) | 70 | `https://app.givesuite.com/v2/preview/OmcbmxnJibm8i6lOARyK?notrack=true` | "Upgrade" button — redirects trial users to GHL funnel |
| [app/admin/manage-subscription/page.tsx](../app/admin/manage-subscription/page.tsx#L12) | 12 | `https://d9fnnfprjjkmmmxauclr.app.clientclub.net/` | Client Club subscription management (iframe embed) |
| [components/facts-iframe.tsx](../components/facts-iframe.tsx#L10) | 10 | `https://factsmgt.com` | FACTS management system (iframe embed) |

---

## Summary: What to do when changing the domain

1. **Set env vars** (`NEXT_PUBLIC_BASE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXTAUTH_URL`) to the new domain in Vercel and `.env`.
2. **Update Stripe Dashboard** → Webhooks: change all registered endpoint URLs to the new domain (see Section 2).
3. **Update Payroc** event subscription URL (currently `webhook.site` test URL — needs the real new domain).
4. **Update Fundrazr** payment-sync webhook URL in Fundrazr settings.
5. **Update GHL** `GHL_WEBHOOK_URL` env var if it points to the old domain.
6. **Confirm n8n** `send-n8n-manual-donation.ts` should use `webhook-test` vs production URL.
7. **Confirm Payroc** environment: all Payroc calls currently hit UAT (`api.uat.payroc.com`) — switch to prod if needed.
