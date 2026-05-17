/**
 * Handler: AppUninstall
 *
 * Fired by GHL when a customer removes the Donor HQ app from a sub-account.
 * We soft-revoke the connection row — NEVER delete it — so history stays
 * intact for audit. getValidAccessToken() will refuse subsequent calls.
 *
 * If the customer later re-installs, upsertTokenRecord() will flip the row
 * back to status='active' and clear revoked_at/revoked_reason.
 */
import { markTokenRevoked } from "../oauth-storage";
import type { GhlWebhookEnvelope } from "../webhook-types";

export async function handleAppUninstall(
  _payload: GhlWebhookEnvelope,
  locationId: string,
): Promise<void> {
  await markTokenRevoked(locationId, "user_uninstalled");

  // Audit log so the action appears in /admin/log-reports.
  try {
    const { logAudit } = await import("@/lib/audit");
    await logAudit("ghl_uninstall", {
      entity: "ghl_oauth_tokens",
      locationId,
      reason: "user_uninstalled",
    });
  } catch (err) {
    console.error(
      "[ghl-webhook] audit log failed for AppUninstall (non-fatal):",
      err instanceof Error ? err.message : String(err),
    );
  }
}
