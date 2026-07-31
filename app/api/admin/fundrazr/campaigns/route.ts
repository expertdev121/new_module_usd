/**
 * GET /api/admin/fundrazr/campaigns — live list of the connected
 * organization's campaigns from ConnectionPoint. Read-only.
 *
 * Returns 409 if the location has no saved connection yet, so the UI
 * can prompt the admin to enter their org id.
 */
import { NextResponse } from "next/server";
import { requireFundrazrAdmin } from "@/lib/fundrazr/auth-guard";
import { getConnectionForLocation } from "@/lib/fundrazr/connection-storage";
import {
  FundrazrApiError,
  listCampaignsForOrganization,
} from "@/lib/fundrazr/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireFundrazrAdmin();
  if (guard.error) return guard.error;

  const conn = await getConnectionForLocation(guard.session.user.locationId);
  if (!conn || conn.status !== "active") {
    return NextResponse.json(
      {
        error: "not_connected",
        message: "Enter your FundRazr organization ID to see campaigns.",
      },
      { status: 409 },
    );
  }

  const url = new URL(req.url);
  const status = url.searchParams.get("status") ?? undefined;

  try {
    const campaigns = await listCampaignsForOrganization(conn.organizationId, {
      status: status || undefined,
    });
    return NextResponse.json({
      organizationId: conn.organizationId,
      organizationName: conn.organizationName,
      count: campaigns.length,
      campaigns,
    });
  } catch (err) {
    if (err instanceof FundrazrApiError) {
      if (err.isConfigError) {
        return NextResponse.json(
          { error: "config_error", message: err.message },
          { status: 500 },
        );
      }
      return NextResponse.json(
        {
          error: "upstream_error",
          message: `FundRazr returned HTTP ${err.status}.`,
          detail: err.body ?? null,
        },
        { status: 502 },
      );
    }
    throw err;
  }
}
