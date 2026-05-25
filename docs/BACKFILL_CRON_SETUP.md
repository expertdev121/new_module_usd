# Backfill Cron Setup

## Current setup (Vercel Pro — native cron)

The backfill is now driven by a native Vercel cron declared in
`vercel.json`:

```json
"crons": [
  { "path": "/api/admin/backfill/cron", "schedule": "* * * * *" }
]
```

Vercel fires `/api/admin/backfill/cron` every minute. Each tick has a
240s wall-clock budget (function maxDuration is 300s on Pro) so a
single invocation can drain ~3,000–4,000 contacts. Authentication uses
the auto-injected `Authorization: Bearer ${CRON_SECRET}` header.

Nothing to do here — it Just Works on every deploy.

If you ever **disable Vercel cron** (downgrade or schedule change),
fall back to the cron-job.org instructions below.

---

## Fallback: cron-job.org (free Vercel plan)

Use this only if Vercel cron isn't an option (free plan only supports
daily crons). It pings our endpoint every minute over HTTPS.

## One-time setup (≈ 2 minutes)

1. **Confirm `CRON_SECRET` is set in Vercel.**

   Vercel → Project → Settings → Environment Variables → `CRON_SECRET` must
   exist for **Production** (and Preview, if you want backfill on preview
   deployments). Generate one with `openssl rand -hex 32` if you don't have
   one yet. **Do not commit the value to git.**

2. **Sign up at https://cron-job.org** (free, no card required).

3. **Create a new cron job:**

   | Field | Value |
   |---|---|
   | Title | `DonorHQ backfill drain` |
   | URL | `https://YOUR-DOMAIN.vercel.app/api/admin/backfill/cron?secret=THE_CRON_SECRET_VALUE` |
   | Schedule | Every **1 minute** (`* * * * *`) |
   | Request method | `GET` |
   | Notifications | Optional — enable "Notify on failure" so cron-job.org emails you if our endpoint returns 5xx |
   | Save responses | Optional — handy for debugging the first day, can disable after |

   Replace `YOUR-DOMAIN` with your live Vercel URL and
   `THE_CRON_SECRET_VALUE` with the actual secret value from Vercel.

4. **Test it.** Click "Run now" inside cron-job.org. Within a few seconds
   you should see a 200 response with a JSON body like:

   ```json
   { "chunks_processed": 0, "drained": true, "elapsed_ms": 142 }
   ```

   `drained: true` with zero chunks means the queue is empty — that's the
   correct response when there's nothing to backfill yet.

5. **Trigger a real backfill to verify end-to-end.**

   - Go to `/admin/connections` in DonorHQ as an admin.
   - Click **"Sync now"**.
   - The progress bar should appear and start advancing within ~60s as
     cron-job.org's pings drain the queue.

## What the URL does

`GET /api/admin/backfill/cron?secret=<CRON_SECRET>`

- Authenticates via either `Authorization: Bearer <CRON_SECRET>` header
  **or** `?secret=<CRON_SECRET>` query param (cron-job.org's free tier
  doesn't support custom headers, so we use the query-param form).
- Pulls the oldest queued/running job, processes ~45 seconds of chunks,
  and returns a summary. Safe to call any number of times — extra pings
  on an empty queue just return `{drained: true}` and cost nothing.
- Throughput per tick: roughly 1,000–1,500 contacts depending on GHL's
  API latency. A 5,000-contact sub-account drains in ~4–5 minutes.

## Security notes

- The secret travels in the URL query string. cron-job.org's outbound
  TLS protects it in transit, and the secret is **only** used to drain
  the backfill queue — it doesn't unlock any other DonorHQ data.
- Rotate `CRON_SECRET` if you ever suspect it leaked: update the Vercel
  env var, redeploy, then update the cron-job.org URL. Old pings will
  start getting 401s.
- The endpoint is also rate-limited by virtue of the per-job lease — even
  if someone hammered it with the secret, they'd just churn the same
  jobs (no data exposure).

## Moving to Vercel Pro later

When you upgrade:

1. Add back the `crons` array in `vercel.json` (the comment field shows
   the exact line).
2. Disable or delete the cron-job.org schedule (or keep it as a backup —
   the endpoint is idempotent, two pingers won't double-process).
3. Redeploy.
