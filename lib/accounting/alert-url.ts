/**
 * The failure-alert webhook is a GoHighLevel inbound-webhook trigger URL (same pattern as receipts):
 * https://services.leadconnectorhq.com/hooks/<location>/webhook-trigger/<id>
 * Only that shape is accepted, so the setting can never be used to make the server call an arbitrary address.
 */
export const ALERT_URL_MESSAGE = "Use the GoHighLevel inbound webhook URL (it starts with https://services.leadconnectorhq.com/hooks/).";

/** Returns an error message, or null when the URL is an acceptable GoHighLevel webhook. */
export function checkAlertUrl(value: string): string | null {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return ALERT_URL_MESSAGE;
  }
  const host = u.hostname.toLowerCase();
  const ghlHost = host === "leadconnectorhq.com" || host.endsWith(".leadconnectorhq.com");
  if (u.protocol !== "https:" || !ghlHost || u.username || u.password || u.port || !u.pathname.startsWith("/hooks/")) return ALERT_URL_MESSAGE;
  if (value.length > 500) return "That URL is too long.";
  return null;
}

/** For logs and the audit trail: the webhook URL acts like a password, so never store it whole. */
export function redactAlertUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return `${new URL(value).hostname}/…`;
  } catch {
    return "(set)";
  }
}

export const MAX_ALERT_EMAILS = 3;
const EMAIL_RE = /^[^\s@<>(),;:"']+@[^\s@<>(),;:"']+\.[^\s@<>(),;:"']{2,}$/;

/**
 * The alert addresses as typed ("a@x.org, b@y.org"): trimmed, lower-cased, duplicates dropped.
 * Returns the clean list, or a plain-words error. At most 3, so the setting cannot be used to mass-mail.
 */
export function parseAlertEmails(value: string | null | undefined): { emails: string[]; error: string | null } {
  const parts = (value ?? "")
    .split(/[\s,;]+/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const emails = Array.from(new Set(parts));
  for (const e of emails) {
    if (e.length > 254 || !EMAIL_RE.test(e)) return { emails: [], error: `"${e.slice(0, 60)}" is not a valid email address.` };
  }
  if (emails.length > MAX_ALERT_EMAILS) return { emails: [], error: `Use at most ${MAX_ALERT_EMAILS} email addresses.` };
  return { emails, error: null };
}
