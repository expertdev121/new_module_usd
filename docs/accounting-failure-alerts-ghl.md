# Accounting failure alerts through GoHighLevel

When the **nightly** QuickBooks sync fails, DonorHQ sends one message to a GoHighLevel inbound webhook, and a GHL workflow turns it into an email. This is the same pattern receipts use. Nothing is sent when a sync succeeds, when there is nothing to post, or when the sync only stopped early for time.

## Set it up (per organization, in that organization's GHL sub-account)

1. In GHL, create a workflow with the trigger **Inbound Webhook** and copy its URL. It looks like `https://services.leadconnectorhq.com/hooks/<location>/webhook-trigger/<id>`.
2. In DonorHQ, open **Settings > Accounting > General**, paste it into **Failure alert (GoHighLevel webhook)**, and press **Save settings**.
3. Press **Send test alert**. GHL receives a sample message; open the workflow's trigger and choose that request as the sample so the fields below can be mapped.
4. Add an **Send Email** action. Use `{{inboundWebhookRequest.message}}` as the body: it is already a complete sentence with the reason and a link.
5. Publish the workflow.

Only a GoHighLevel webhook URL is accepted (https, `leadconnectorhq.com`, path `/hooks/`). Anything else is refused when saving, and again before sending. The URL is treated like a password: the audit log keeps only its host.

## What it sends

A flat JSON message (so GHL can map each field by name):

| Field | Meaning |
|---|---|
| `event` | `accounting_sync_failed`, or `accounting_alert_test` for the test button |
| `location_id` | the organization |
| `status` | `failed` or `partial` (some posted, some did not) |
| `posted`, `failed` | counts for that run |
| `error` | first problem in plain words, cut to 300 characters; includes the Intuit reference when QuickBooks gave one |
| `trigger` | `nightly` |
| `run_id` | the run in the sync log |
| `link` | link to Accounting in DonorHQ |
| `message` | a ready-to-send sentence built from the fields above |
| `occurred_at` | ISO time |

## Rules

- At most **one alert per organization every 20 hours**, even if several runs fail.
- A failed delivery (GHL down, wrong URL) never affects the sync. It is logged and shown in the audit trail as `alert_failed`.
- It is for the nightly job. A person pressing **Sync now** already sees the result on screen.
- Needs migration **0034** (adds two nullable columns to `accounting_settings`). It is applied with 0030 to 0033.
