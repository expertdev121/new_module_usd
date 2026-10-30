/**
 * The message sent to the GoHighLevel workflow when a sync fails. Pure: no database, no network.
 */

export interface SyncAlertInfo {
  locationId: string;
  status: string;
  posted: number;
  failed: number;
  error: string | null;
  trigger: string;
  runId: number | null;
}

/** Flat keys on purpose: GoHighLevel maps webhook fields by name in the workflow editor. */
export function buildAlertPayload(event: "accounting_sync_failed" | "accounting_alert_test", info: SyncAlertInfo, link: string | null, recipientEmail: string | null = null) {
  const problem = info.error ? info.error.slice(0, 300) : null;
  const message =
    event === "accounting_alert_test"
      ? "This is a test alert from DonorHQ Accounting. If you can read this, failure alerts for your QuickBooks sync will reach you here."
      : `DonorHQ could not send ${info.failed > 0 ? `${info.failed} ${info.failed === 1 ? "deposit" : "deposits"}` : "your deposits"} to QuickBooks.${problem ? ` Reason: ${problem}` : ""} ${link ? `Open Accounting to retry: ${link}` : "Open Accounting in DonorHQ to retry."}`;
  return {
    event,
    /** Set when the shared GoHighLevel workflow should email this person; null for an organization's own webhook. */
    recipient_email: recipientEmail,
    subject: event === "accounting_alert_test" ? "DonorHQ test alert" : "DonorHQ: QuickBooks sync problem",
    location_id: info.locationId,
    status: info.status,
    posted: info.posted,
    failed: info.failed,
    error: problem,
    trigger: info.trigger,
    run_id: info.runId,
    link,
    message,
    occurred_at: new Date().toISOString(),
  };
}
