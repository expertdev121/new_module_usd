/**
 * Failure alerts: when a nightly QuickBooks sync fails, post one JSON message to the organization's
 * GoHighLevel inbound-webhook URL; a GHL workflow turns it into an email (same way receipts go out).
 *
 * Safe by design: it never throws into the sync, it only ever calls a validated leadconnectorhq.com
 * webhook (no redirects, 5 second limit), and an organization is alerted at most once every 20 hours.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { getCanonicalAppUrl } from "@/lib/config/app-url";
import { checkAlertUrl, redactAlertUrl } from "./alert-url";
import { buildAlertPayload, type SyncAlertInfo } from "./alert-payload";
import { writeAuditSafe } from "./audit";
import { errorText, rows } from "./sql-helpers";

export const ALERT_MIN_INTERVAL_HOURS = 20;
const TIMEOUT_MS = 5000;

async function deliver(url: string, body: unknown): Promise<{ ok: boolean; detail: string }> {
  const bad = checkAlertUrl(url);
  if (bad) return { ok: false, detail: "The saved alert URL is not a GoHighLevel webhook." };
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

/**
 * Called after a failed sync. Claims the 20-hour slot in one statement (so two runs cannot both send),
 * then delivers. Returns what happened; never throws.
 */
export async function sendFailureAlert(info: SyncAlertInfo): Promise<"sent" | "no_url" | "throttled" | "failed"> {
  try {
    const claimed = await rows(sql`
      update accounting_settings set alert_last_sent_at = now()
      where location_id = ${info.locationId} and alert_webhook_url is not null
        and (alert_last_sent_at is null or alert_last_sent_at < now() - (${ALERT_MIN_INTERVAL_HOURS} * interval '1 hour'))
      returning alert_webhook_url`);
    if (claimed.length === 0) {
      const [s] = await rows(sql`select alert_webhook_url from accounting_settings where location_id = ${info.locationId}`);
      return s?.alert_webhook_url ? "throttled" : "no_url";
    }
    const url = String(claimed[0].alert_webhook_url);
    const result = await deliver(url, buildAlertPayload("accounting_sync_failed", info, safeLink()));
    await writeAuditSafe({
      locationId: info.locationId,
      userId: null,
      action: result.ok ? "alert_sent" : "alert_failed",
      object: "accounting_alert",
      after: { to: redactAlertUrl(url), detail: result.detail, failed: info.failed, status: info.status },
    });
    if (!result.ok) console.error("[accounting-alert] not delivered:", info.locationId, result.detail);
    return result.ok ? "sent" : "failed";
  } catch (err) {
    console.error("[accounting-alert] unexpected error:", info.locationId, errorText(err));
    return "failed";
  }
}

/** The "Send test alert" button: uses the saved URL, ignores the 20-hour limit, and reports plainly. */
export async function sendTestAlert(locationId: string): Promise<{ ok: boolean; message: string }> {
  const [s] = await rows(sql`select alert_webhook_url from accounting_settings where location_id = ${locationId}`);
  const url = s?.alert_webhook_url ? String(s.alert_webhook_url) : null;
  if (!url) return { ok: false, message: "Save a webhook URL first, then send the test." };
  const result = await deliver(url, buildAlertPayload("accounting_alert_test", { locationId, status: "test", posted: 0, failed: 0, error: null, trigger: "manual", runId: null }, safeLink()));
  return { ok: result.ok, message: result.ok ? "Test alert sent. Check that your GoHighLevel workflow ran." : result.detail };
}
