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
export interface PayloadOptions {
  /** The recipient has not confirmed this address yet: the email carries the confirm link instead. */
  confirm?: boolean;
}

export function buildAlertPayload(event: "accounting_sync_failed" | "accounting_alert_test", info: SyncAlertInfo, link: string | null, recipientEmail: string | null = null, opts: PayloadOptions = {}) {
  const problem = info.error ? info.error.slice(0, 300) : null;
  const message =
    event === "accounting_alert_test" && opts.confirm
      ? "This is a test email from DonorHQ Accounting. To finish setting up, press the link below to confirm you received it. Failure alerts for your QuickBooks sync are only sent to confirmed addresses."
      : event === "accounting_alert_test"
      ? "This is a test alert from DonorHQ Accounting. If you can read this, failure alerts for your QuickBooks sync will reach you here."
      : `DonorHQ could not send ${info.failed > 0 ? `${info.failed} ${info.failed === 1 ? "deposit" : "deposits"}` : "your deposits"} to QuickBooks.${problem ? ` Reason: ${problem.replace(/[.\s]+$/, "")}.` : ""} Open DonorHQ Accounting to retry.`;
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
    /** The words for the link in the email: a confirm link for a new address, otherwise a link to Accounting. */
    link_text: opts.confirm ? "Confirm you received this email" : "Open DonorHQ Accounting",
    message,
    occurred_at: new Date().toISOString(),
  };
}
