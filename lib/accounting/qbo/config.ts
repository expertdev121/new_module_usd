/**
 * QuickBooks Online app settings, all from environment variables (never stored in the database):
 *   QBO_CLIENT_ID, QBO_CLIENT_SECRET  - from the Intuit developer portal (Keys & credentials)
 *   QBO_REDIRECT_URI                  - must match a Redirect URI registered in the Intuit app,
 *                                       e.g. https://<app>/api/admin/accounting/connection/callback
 *   QBO_ENVIRONMENT                   - "sandbox" (default) or "production"
 *   ACCOUNTING_ENC_KEY                - 32 bytes base64, encrypts tokens at rest (openssl rand -base64 32)
 *   CRON_SECRET                       - protects the nightly sync endpoint
 */
export class QboConfigError extends Error {}

export type QboEnvironment = "sandbox" | "production";

export const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
export const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const REVOKE_URL = "https://developer.api.intuit.com/v2/oauth2/tokens/revoke";
export const SCOPE = "com.intuit.quickbooks.accounting";
export const MINOR_VERSION = "75";

export function apiBase(env: QboEnvironment): string {
  return env === "production" ? "https://quickbooks.api.intuit.com" : "https://sandbox-quickbooks.api.intuit.com";
}

export function qboEnvironment(): QboEnvironment {
  return process.env.QBO_ENVIRONMENT === "production" ? "production" : "sandbox";
}

export function isQboConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET && process.env.QBO_REDIRECT_URI && process.env.ACCOUNTING_ENC_KEY);
}

export function qboConfig() {
  const clientId = process.env.QBO_CLIENT_ID;
  const clientSecret = process.env.QBO_CLIENT_SECRET;
  const redirectUri = process.env.QBO_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new QboConfigError("QuickBooks is not configured on this server (QBO_CLIENT_ID, QBO_CLIENT_SECRET and QBO_REDIRECT_URI are required).");
  }
  return { clientId, clientSecret, redirectUri, environment: qboEnvironment() };
}
