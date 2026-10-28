/**
 * Failure alerts: when a nightly QuickBooks sync fails, tell the organization.
 *
 * Two channels, both through GoHighLevel inbound webhooks (the pattern receipts already use):
 *  - Email: one SHARED workflow in our own GoHighLevel account (env ACCOUNTING_ALERT_WEBHOOK_URL). DonorHQ posts
 *    the message once per alert address with `recipient_email`; the workflow emails that person. Users only type
 *    an address, there is nothing to set up per organization.
 *  - Webhook: an organization's own GoHighLevel webhook URL (optional, for orgs that want to route it themselves).
 *
 * Safe by design: it never throws into the sync, it only ever calls a validated leadconnectorhq.com webhook (no
 * redirects, 5 second limit), an organization is alerted at most once every 20 hours, and test sends are limited.
 */
import { sql } from "drizzle-orm";
import { getCanonicalAppUrl } from "@/lib/config/app-url";
import { checkAlertUrl, parseAlertEmails, redactAlertUrl } from "./alert-url";
import { buildAlertPayload, type SyncAlertInfo } from "./alert-payload";
import { writeAuditSafe } from "./audit";
import { errorText, rows } from "./sql-helpers";

export const ALERT_MIN_INTERVAL_HOURS = 20;
export const MAX_TESTS_PER_HOUR = 5;
const TIMEOUT_MS = 5000;

/** The shared workflow's webhook, from the server environment. Null when missing or not a GoHighLevel URL. */
export function sharedEmailWebhook(): string | null {
  const url = process.env.ACCOUNTING_ALERT_WEBHOOK_URL?.trim();
  return url && checkAlertUrl(url) === null ? url : null;
}
export const emailAlertsAvailable = () => sharedEmailWebhook() !== null;

async function deliver(url: string, body: unknown): Promise<{ ok: boolean; detail: string }> {
  const bad = checkAlertUrl(url);
  if (bad) return { ok: false, detail: "The alert URL is not a GoHighLevel webhook." };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: ctl.signal,
    });
    return res.ok ? { ok: true, detail: `Delivered (${res.status}).` } : { ok: false, detail: `GoHighLevel answered ${res.status}.` };
  } catch (err) {
    return { ok: false, detail: ctl.signal.aborted ? "GoHighLevel did not answer in time." : `Could not reach GoHighLevel: ${errorText(err).slice(0, 120)}` };
  } finally {
    clearTimeout(timer);
  }
}

const safeLink = () => {
  try {
    return `${getCanonicalAppUrl()}/admin/accounting`;
  } catch {
    return null;
  }
};

interface ChannelResult {
  channel: "email" | "webhook";
  ok: boolean;
  detail: string;
}

/** Sends one alert on every channel the organization has set up. Returns one result per attempt; never throws. */
async function sendOnChannels(event: "accounting_sync_failed" | "accounting_alert_test", info: SyncAlertInfo, emails: string[], webhookUrl: string | null): Promise<ChannelResult[]> {
  const link = safeLink();
  const results: ChannelResult[] = [];
  if (webhookUrl) {
    const r = await deliver(webhookUrl, buildAlertPayload(event, info, link, null));
    results.push({ channel: "webhook", ...r });
  }
  if (emails.length > 0) {
    const shared = sharedEmailWebhook();
    if (!shared) {
      results.push({ channel: "email", ok: false, detail: "Email alerts are not switched on for this server yet." });
    } else {
      for (const to of emails) {
        const r = await deliver(shared, buildAlertPayload(event, info, link, to));
        results.push({ channel: "email", ...r });
      }
    }
  }
  return results;
}

/**
 * Called after a failed sync. Claims the 20-hour slot in one statement (so two runs cannot both send),
 * then delivers on every channel. Returns what happened; never throws.
 */
export async function sendFailureAlert(info: SyncAlertInfo): Promise<"sent" | "no_url" | "throttled" | "failed"> {
  try {
    const claimed = await rows(sql`
      update accounting_settings set alert_last_sent_at = now()
      where location_id = ${info.locationId} and (alert_webhook_url is not null or alert_emails is not null)
        and (alert_last_sent_at is null or alert_last_sent_at < now() - (${ALERT_MIN_INTERVAL_HOURS} * interval '1 hour'))
      returning alert_webhook_url, alert_emails`);
    if (claimed.length === 0) {
      const [s] = await rows(sql`select alert_webhook_url, alert_emails from accounting_settings where location_id = ${info.locationId}`);
      return s?.alert_webhook_url || s?.alert_emails ? "throttled" : "no_url";
    }
    const webhookUrl = claimed[0].alert_webhook_url ? String(claimed[0].alert_webhook_url) : null;
    const emails = parseAlertEmails(claimed[0].alert_emails ? String(claimed[0].alert_emails) : null).emails;
    const results = await sendOnChannels("accounting_sync_failed", info, emails, webhookUrl);
    const anyOk = results.some((r) => r.ok);
    await writeAuditSafe({
      locationId: info.locationId,
      userId: null,
      action: anyOk ? "alert_sent" : "alert_failed",
      object: "accounting_alert",
      // Addresses and the webhook path are not written to the audit trail: only counts, the host and what happened.
      after: { webhook: webhookUrl ? redactAlertUrl(webhookUrl) : null, emails: emails.length, results: results.map((r) => ({ channel: r.channel, ok: r.ok, detail: r.detail })), failed: info.failed, status: info.status },
    });
    for (const r of results) if (!r.ok) console.error("[accounting-alert] not delivered:", info.locationId, r.channel, r.detail);
    return anyOk ? "sent" : "failed";
  } catch (err) {
    console.error("[accounting-alert] unexpected error:", info.locationId, errorText(err));
    return "failed";
  }
}

/**
 * The "Send test email" button: sends a sample to the SAVED addresses and webhook, ignores the 20-hour limit but
 * allows only 5 tests an hour per organization, and reports plainly.
 */
export async function sendTestAlert(locationId: string): Promise<{ ok: boolean; message: string }> {
  const [s] = await rows(sql`select alert_webhook_url, alert_emails from accounting_settings where location_id = ${locationId}`);
  const webhookUrl = s?.alert_webhook_url ? String(s.alert_webhook_url) : null;
  const emails = parseAlertEmails(s?.alert_emails ? String(s.alert_emails) : null).emails;
  if (!webhookUrl && emails.length === 0) return { ok: false, message: "Save an alert email address first, then send the test." };

  const [recent] = await rows(sql`select count(*)::int as n from accounting_audit where location_id = ${locationId} and action = 'alert_test' and at > now() - interval '1 hour'`);
  if (Number(recent?.n ?? 0) >= MAX_TESTS_PER_HOUR) return { ok: false, message: `You can send ${MAX_TESTS_PER_HOUR} test alerts an hour. Try again later.` };

  const results = await sendOnChannels("accounting_alert_test", { locationId, status: "test", posted: 0, failed: 0, error: null, trigger: "manual", runId: null }, emails, webhookUrl);
  await writeAuditSafe({
    locationId,
    userId: null,
    action: "alert_test",
    object: "accounting_alert",
    after: { webhook: webhookUrl ? redactAlertUrl(webhookUrl) : null, emails: emails.length, results: results.map((r) => ({ channel: r.channel, ok: r.ok, detail: r.detail })) },
  });

  const okEmails = results.filter((r) => r.channel === "email" && r.ok).length;
  const bad = results.find((r) => !r.ok);
  if (bad) return { ok: false, message: bad.channel === "email" ? `The test email could not be sent. ${bad.detail}` : `The webhook did not accept the test. ${bad.detail}` };
  const parts: string[] = [];
  if (okEmails > 0) parts.push(`Test email sent to ${okEmails} ${okEmails === 1 ? "address" : "addresses"}. It can take a minute; check your inbox and spam folder.`);
  if (webhookUrl) parts.push("Test sent to the webhook.");
  return { ok: true, message: parts.join(" ") };
}
