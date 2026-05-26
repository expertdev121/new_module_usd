/**
 * GET /api/admin/ghl-connection-status
 *
 * Lightweight read for any logged-in admin to find out whether their
 * sub-account has a working GHL connection. Powers the "Connect to
 * GoHighLevel" banner that shows on /contacts (and anywhere else we
 * want to nudge admins to install the app).
 *
 * Returns the canonical canSyncLocation result plus the recommended
 * install URL (so the UI doesn't need to duplicate that env lookup).
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canSyncLocation } from "@/lib/ghl/connection-check";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  // Anyone with a location can see this — admins + non-admin contacts.
  // Non-admins won't see the banner anyway (we gate that in the UI on
  // role) but we keep the endpoint open so they can hit it too.
  if (!session.user.locationId) {
    return NextResponse.json({
      canSync: false,
      reason: "no_session_location",
      message: "No location on your session.",
      installUrl: null,
    });
  }

  const result = await canSyncLocation(session.user.locationId);

  // Build the install URL once here so the UI doesn't need to know about
  // env vars. NEXT_PUBLIC_GHL_INSTALL_URL is the customer-facing landing
  // and falls back to our local /api/oauth/install initiator if not set.
  const installUrl =
    process.env.NEXT_PUBLIC_GHL_INSTALL_URL || "/api/oauth/install";

  return NextResponse.json({
    canSync: result.canSync,
    reason: result.reason,
    message: result.message,
    installUrl,
    locationId: session.user.locationId,
  });
}
