/**
 * GET    /api/admin/fundrazr/connect — sanitized status for the UI.
 * POST   /api/admin/fundrazr/connect — save/update org id for the location.
 *                                       Validates by calling ConnectionPoint
 *                                       once; only persists if that succeeds.
 * DELETE /api/admin/fundrazr/connect — mark disconnected. Soft: row stays.
 */
import { NextResponse } from "next/server";
import { requireFundrazrAdmin } from "@/lib/fundrazr/auth-guard";
import {
  getConnectionForLocation,
  markDisconnected,
  sanitizeForClient,
  upsertConnection,
} from "@/lib/fundrazr/connection-storage";
import {
  FundrazrApiError,
  getOrganization,
} from "@/lib/fundrazr/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireFundrazrAdmin();
  if (guard.error) return guard.error;

  const conn = await getConnectionForLocation(guard.session.user.locationId);
  if (!conn) return NextResponse.json({ connection: null });
  return NextResponse.json({ connection: sanitizeForClient(conn) });
}

export async function POST(req: Request) {
  const guard = await requireFundrazrAdmin();
  if (guard.error) return guard.error;

  let body: { organizationId?: string } = {};
  try {
    body = await req.json();
  } catch {
    // fall through — validation below catches missing id.
  }
  const raw = (body.organizationId ?? "").trim();
  if (!raw) {
    return NextResponse.json(
      { error: "invalid_request", message: "organizationId is required." },
      { status: 400 },
    );
  }
  // Guardrail: ConnectionPoint org ids are opaque but bounded. Reject
  // obviously-wrong pastes (URLs, whitespace) before we spend an API call.
  if (raw.length > 128 || /\s|\//.test(raw)) {
    return NextResponse.json(
      {
        error: "invalid_request",
        message:
          "That doesn't look like an organization ID. Paste just the ID, not a URL.",
      },
      { status: 400 },
    );
  }

  // Live-validate against ConnectionPoint before saving. This proves the
  // id exists AND that our server-wide token can read it.
  let orgName: string | null = null;
  try {
    const org = await getOrganization(raw);
    orgName = org?.name ?? null;
  } catch (err) {
    if (err instanceof FundrazrApiError) {
      if (err.isConfigError) {
        return NextResponse.json(
          {
            error: "config_error",
            message: err.message,
          },
          { status: 500 },
        );
      }
      if (err.status === 404) {
        return NextResponse.json(
          {
            error: "not_found",
            message:
              "That organization was not found on FundRazr. Double-check the ID.",
          },
          { status: 404 },
        );
      }
      if (err.isAuthError) {
        return NextResponse.json(
          {
            error: "upstream_auth",
            message:
              "FundRazr rejected our credentials. Ask a super-admin to check FUNDRAZR_API_KEY.",
          },
          { status: 502 },
        );
      }
      return NextResponse.json(
        {
          error: "upstream_error",
          message: `FundRazr returned HTTP ${err.status}.`,
        },
        { status: 502 },
      );
    }
    throw err;
  }

  const row = await upsertConnection({
    locationId: guard.session.user.locationId,
    organizationId: raw,
    organizationName: orgName,
    createdBy:
      typeof guard.session.user.id === "number"
        ? guard.session.user.id
        : Number(guard.session.user.id) || null,
  });

  return NextResponse.json({ connection: sanitizeForClient(row) });
}

export async function DELETE() {
  const guard = await requireFundrazrAdmin();
  if (guard.error) return guard.error;
  await markDisconnected(guard.session.user.locationId);
  return NextResponse.json({ ok: true });
}
