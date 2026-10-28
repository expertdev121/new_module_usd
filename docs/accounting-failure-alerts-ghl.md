# Accounting failure alerts by email (one shared GoHighLevel workflow)

When the **nightly** QuickBooks sync fails, DonorHQ emails the people the organization listed. Users set it up themselves: they type up to 3 email addresses in **Settings > Accounting > General > "Email me if the nightly sync fails"** and press **Send test email**. There is nothing to build per organization.

Behind the scenes DonorHQ posts a small JSON message to **one shared GoHighLevel workflow** (in our own GHL account), once per address. The workflow emails that person. Nothing is sent when a sync succeeds, has nothing to post, or only stopped early for time.

## One-time setup (done once for the whole platform)

1. In our own GoHighLevel account, create a workflow with the trigger **Inbound Webhook**. Copy its URL (`https://services.leadconnectorhq.com/hooks/<location>/webhook-trigger/<id>`).
2. In **Vercel > Settings > Environment Variables** add `ACCOUNTING_ALERT_WEBHOOK_URL` = that URL (Production, and Preview if you want to test there). Redeploy.
3. In DonorHQ press **Send test email** once so GHL receives a sample, then choose that request as the sample in the trigger so the fields below can be mapped.
4. Add the actions, in this order:
   - **Create/Update Contact**: Email = `{{inboundWebhookRequest.recipient_email}}`. Add the tag `accounting-alert` so these contacts stay out of marketing lists.
   - **Send Email** to that contact: Subject = `{{inboundWebhookRequest.subject}}`, Body = `{{inboundWebhookRequest.message}}`.
5. Publish the workflow.

Until `ACCOUNTING_ALERT_WEBHOOK_URL` is set, the screen says "Email alerts are not switched on for this server yet" and the test button reports that plainly. Nothing else is affected.

## What is sent

A flat JSON message (GHL maps fields by name):

| Field | Meaning |
|---|---|
| `recipient_email` | who to email (null when it goes to an organization's own webhook) |
| `subject` | `DonorHQ: QuickBooks sync problem`, or `DonorHQ test alert` |
| `message` | a ready-to-send sentence with the reason and a link to Accounting |
| `event` | `accounting_sync_failed`, or `accounting_alert_test` for the test button |
| `location_id`, `status`, `posted`, `failed`, `trigger`, `run_id`, `link`, `occurred_at` | details of the run |
| `error` | first problem in plain words, cut to 300 characters (includes the Intuit reference when QuickBooks gave one) |

## Rules and safety

- At most **one alert per organization every 20 hours**, even if several runs fail.
- At most **3 addresses** per organization and **5 test emails an hour**, and the message text is fixed by DonorHQ, so the setting cannot be used to mass-mail.
- Only a GoHighLevel webhook URL (https, `leadconnectorhq.com`, path `/hooks/`) is ever called, with no redirects and a 5 second limit.
- A failed delivery (GHL down, workflow off) never affects the sync. It is logged and shown in the audit trail as `alert_failed`.
- The audit trail records how many addresses were used, never the addresses themselves.
- DonorHQ can only see that GHL **accepted** the message, not that the email reached the inbox. That is why the test button tells the user to check the inbox and spam folder.
- Contacts that were marked do-not-disturb or unsubscribed in GHL will not receive the email.

## Optional: an organization's own webhook

Under **Advanced** an organization can paste its own GoHighLevel inbound-webhook URL. It receives the same message (with `recipient_email` empty) and can be used instead of, or as well as, the email addresses.

## Database

Needs migration **0034** (adds three nullable columns to `accounting_settings`). It is applied with 0030 to 0033.
