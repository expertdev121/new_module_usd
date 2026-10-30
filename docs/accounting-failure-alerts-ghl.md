# Accounting failure alerts by email (one shared GoHighLevel workflow)

When the **nightly** QuickBooks sync fails, DonorHQ emails the people the organization listed. Users set it up themselves in **Settings > Accounting > General > "Email me if the nightly sync fails"**: type up to 3 addresses, save, press **Send test email**, then open the email and press **Confirm you received this email**. There is nothing to build per organization.

DonorHQ posts a small JSON message to **one shared GoHighLevel workflow**, once per address. The workflow emails that person. Nothing is sent when a sync succeeds, has nothing to post, or only stopped early for time.

## What is already set up (2026-10-30)

- **Workflow:** "DonorHQ Accounting Alert Email" in the **GiveSuite LLC** GoHighLevel sub-account, published. Steps: Inbound Webhook trigger, then Create/Update contact (Email = `recipient_email`), then Add tag `accounting-alert`, then Send email (Subject = `subject`; body = `message`, then the `link` shown as `link_text`). Click tracking is off; "Allow re-entry" is on (without it a second alert to the same person would be skipped).
- **Vercel:** `ACCOUNTING_ALERT_WEBHOOK_URL` = that workflow's webhook URL (Production, secret). It takes effect on the next production deploy, which happens after the accounting branch is merged.
- Emails go out from the account's default sender (currently "GiveSuite LLC" / sean@givesuite.com).

To rebuild it elsewhere: create a workflow with an **Inbound Webhook** trigger, send one sample request (the "Send test email" message) so GHL has a mapping reference, add the steps above, publish, and put its URL in `ACCOUNTING_ALERT_WEBHOOK_URL`.

## Confirmed addresses

- The test email carries a signed link (valid 7 days, bound to that address and organization). Opening it shows a page with a **Confirm** button; only pressing the button confirms, so mail scanners that pre-open links cannot confirm by accident.
- **Only confirmed addresses get real failure alerts.** An address edited out of the list loses its confirmation.
- The confirm link is signed with its own key derived from the app secret, so it cannot be used as any other signed token (and vice versa).

## What is sent

A flat JSON message (GHL maps fields by name):

| Field | Meaning |
|---|---|
| `recipient_email` | who to email (null when it goes to an organization's own webhook) |
| `subject` | `DonorHQ: QuickBooks sync problem`, or `DonorHQ test alert` |
| `message` | a ready-to-send sentence with the reason |
| `link`, `link_text` | a confirm link for a new address, otherwise a link to Accounting |
| `event` | `accounting_sync_failed`, or `accounting_alert_test` for the test button |
| `location_id`, `status`, `posted`, `failed`, `trigger`, `run_id`, `occurred_at` | details of the run |
| `error` | first problem in plain words, cut to 300 characters (includes the Intuit reference when QuickBooks gave one) |

## Rules and safety

- At most **one alert per organization every 20 hours**, even if several runs fail.
- At most **3 addresses** per org and **5 test emails an hour**; the text is fixed by DonorHQ, so the setting cannot be used to mass-mail.
- Only a GoHighLevel webhook URL (https, `leadconnectorhq.com`, path `/hooks/`) is ever called, with no redirects and a 5 second limit.
- A failed delivery never affects the sync. It is logged and shown in the audit trail as `alert_failed`.
- The audit trail records counts and the webhook host, never addresses or the full webhook URL.

## Known limits

- DonorHQ can see that GHL **accepted** the message, not that it reached the inbox. The confirm step is how an address is proven to work.
- GHL adds its standard **unsubscribe** footer. If a recipient unsubscribes, GHL stops emailing that contact; re-enable it from the contact in GHL.
- The Inbound Webhook trigger is a **premium trigger** in GHL (a small charge per run, like the receipt webhooks). Alerts are rare, but every test email is one run.
- Each recipient becomes a contact in the GiveSuite LLC account, tagged `accounting-alert`.

## Optional: an organization's own webhook

Under **Advanced** an organization can paste its own GoHighLevel inbound-webhook URL. It receives the same message (with `recipient_email` empty), instead of or as well as the email addresses.

## Database

Needs migration **0034** (adds nullable columns to `accounting_settings`: `alert_emails`, `alert_emails_verified`, `alert_webhook_url`, `alert_last_sent_at`). It is applied with 0030 to 0033.
