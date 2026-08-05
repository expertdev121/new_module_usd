/**
 * GET  /api/admin/location-settings — read the current tenant's settings.
 * POST /api/admin/location-settings — update. Currently supports only
 *      accountType ('individual' | 'household'). Additive-only endpoint.
 *
 * Anyone who is admin/super_admin of the location can flip the mode.
 * Flipping to household DOES NOT touch existing contact/payment rows —
 * it only unlocks the household UI + endpoints.
 */
import { NextResponse } from "next/server";
import { requireHouseholdAdmin } from "@/lib/household/auth-guard";
import {
  getAccountType,
  setAccountType,
} from "@/lib/household/location-mode";
import type { AccountType } from "@/lib/db/schema-household";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireHouseholdAdmin();
  if (guard.error) return guard.error;
  const accountType = await getAccountType(guard.session.user.locationId);
  return NextResponse.json({ accountType });
}

export async function POST(req: Request) {
  const guard = await requireHouseholdAdmin();
  if (guard.error) return guard.error;

  let body: { accountType?: string } = {};
  try {
    body = await req.json();
  } catch {}
  const value = body.accountType;
  if (value !== "individual" && value !== "household") {
    return NextResponse.json(
      {
        error: "invalid_request",
        message: "accountType must be 'individual' or 'household'.",
      },
      { status: 400 },
    );
  }
  await setAccountType(
    guard.session.user.locationId,
    value as AccountType,
  );
  return NextResponse.json({ accountType: value });
}
