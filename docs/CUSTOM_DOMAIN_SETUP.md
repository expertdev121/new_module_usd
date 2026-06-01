# Custom domain setup — switching from a Vercel preview URL to a real one

This doc captures the exact steps to change the production URL from the
auto-generated Vercel host (e.g. `new-module-usd.vercel.app`) to a custom
domain (e.g. `donorhq.givesuite.com`). Webhooks, OAuth, and the install
flow all depend on the URL being consistent across THREE systems:

  1. Vercel (the deployment + env vars)
  2. GHL Marketplace App settings (redirect URI + webhook URLs)
  3. Our app's env vars (so links in emails, etc. are correct)

If any one of these three drifts, the symptoms are:
  - OAuth install loops or fails with `TOKEN_EXCHANGE_FAILED` /
    `redirect_uri_mismatch`
  - Webhooks 404 because GHL is hitting the old URL
  - Receipts / year-end letters contain broken links to the old host

## Code-level: no hardcoded URLs left

We use a single helper at `lib/config/app-url.ts`:

```ts
import { getCanonicalAppUrl, getOauthRedirectUri, getInstallUrl } from "@/lib/config/app-url";
```

It resolves URLs in this priority:

  1. `NEXT_PUBLIC_APP_URL` env (canonical)
  2. `NEXTAUTH_URL` env (legacy alias)
  3. `VERCEL_URL` env (Vercel preview deployments)
  4. Request origin (last-resort dev fallback)
  5. Throws — never silently uses a stale hardcoded URL

Anything calling `getCanonicalAppUrl()` will pick up the new host
automatically as soon as the env vars are updated.

## Step-by-step migration

### 1. Vercel

1. **Settings → Domains** → add `donorhq.givesuite.com`. Follow the DNS
   instructions Vercel shows (typically a CNAME pointing at
   `cname.vercel-dns.com`).
2. Wait for the SSL cert to provision (usually under 60 seconds).
3. **Settings → Environment Variables** → set / update these for the
   **Production** environment (and Preview if you want previews on the
   custom domain too):

   | Variable | Value |
   |---|---|
   | `NEXT_PUBLIC_APP_URL` | `https://donorhq.givesuite.com` |
   | `NEXTAUTH_URL` | `https://donorhq.givesuite.com` |
   | `GHL_REDIRECT_URI` | `https://donorhq.givesuite.com/api/oauth/callback` |
   | `GHL_INSTALL_URL` | `https://donorhq.givesuite.com/api/oauth/install` |
   | `NEXT_PUBLIC_GHL_INSTALL_URL` | `https://donorhq.givesuite.com/api/oauth/install` |

4. **Redeploy.** Env var changes don't take effect until next deploy —
   trigger one from Deployments tab or push a no-op commit.

### 2. GHL Marketplace App dashboard

In your GHL Marketplace App settings (the app you registered to get
`GHL_APP_ID`):

1. **OAuth → Redirect URIs** → add
   `https://donorhq.givesuite.com/api/oauth/callback`.
   You can leave the old vercel.app URI in place during the transition
   — GHL allows multiple URIs. Remove it later.

2. **Webhooks → Subscription URL** → update to
   `https://donorhq.givesuite.com/api/webhook/marketplace`.
   THIS IS THE MOST IMPORTANT ONE — GHL sends every install /
   uninstall / contact / payment event to this URL. If it still
   points at the old vercel.app, no webhooks arrive at the new
   domain.

3. **Save.** GHL may take a minute to propagate.

### 3. Verify

Open a fresh shell:

```bash
# 1. Canonical URL probe
curl -s https://donorhq.givesuite.com/api/oauth/diag | jq

# Should return JSON where:
#   "envChecks.NEXT_PUBLIC_APP_URL": "set"
#   "redirectUri": "https://donorhq.givesuite.com/api/oauth/callback"

# 2. End-to-end OAuth — install the app on a throwaway test sub-account
#    by visiting:
open https://donorhq.givesuite.com/api/oauth/install

# 3. Live webhook — in GHL, edit a tag on a contact. Within seconds:
curl -s "https://donorhq.givesuite.com/admin/ghl-webhook-logs" \
  -H "Cookie: <your session>" | head

# Should show a new row with `signature_valid=true` and the recent timestamp.
```

### 4. After it all works

1. Remove the old `*.vercel.app` URI from the GHL Marketplace OAuth
   list so old install links can't accidentally complete.
2. Optional — set up a 301 redirect from the old vercel.app URL to the
   custom domain (Vercel domain settings → Redirect to canonical).

## What to check if something breaks

| Symptom | Likely cause |
|---|---|
| `redirect_uri_mismatch` on OAuth install | GHL Marketplace dashboard not updated with the new redirect URI |
| Receipts link to the old vercel.app URL | Env vars set but app not redeployed yet |
| Webhooks stop arriving | GHL Marketplace dashboard webhook URL still points at old host |
| Sign-in loop / "Configuration" error | `NEXTAUTH_URL` doesn't match the actual host the browser is on |
| `getCanonicalAppUrl: no app URL configured` server error | None of the URL env vars are set in Vercel |

## Files that changed for this migration

The helper + all call sites already exist on `main`. Nothing else in the
app needs to change for a custom domain — just env + Marketplace dashboard.

```
lib/config/app-url.ts                          (canonical URL helper)
app/api/webhook/stripe/sync-payment.ts         (receipt PDF link)
app/api/contacts/send-year-end-letters/route.ts (letter PDF link)
app/api/send-receipt/route.ts                  (receipt PDF link)
scripts/integrity-checker.ts                   (exchange-rate API URL)
.env.example                                   (template)
```
