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
import { markTokenRevokedByResource } from "../oauth-storage";
import type { GhlWebhookEnvelope } from "../webhook-types";

export async function handleAppUninstall(
  payload: GhlWebhookEnvelope,
  locationId: string,
): Promise<void> {
  // For sub-account uninstalls, locationId is the resource_id. For
  // agency-level uninstalls, GHL sends just companyId — that's the
  // resource_id instead. Pick whichever the payload tells us about.
  const resourceId = locationId || payload.companyId || payload.locationId;
  if (!resourceId) {
    console.warn("[ghl-webhook] AppUninstall: no resource_id (locationId or companyId) in payload — cannot revoke");
    return;
  }
  await markTokenRevokedByResource(resourceId, "user_uninstalled");

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
