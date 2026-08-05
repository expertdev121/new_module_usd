/**
 * GET  /api/admin/households/:id — household + members + household-level payments.
 * PUT  /api/admin/households/:id — patch the household row.
 *
 * DELETE is intentionally NOT implemented — deleting a household would
 * orphan every linked contact/payment. Use "mark inactive" (later) or
 * detach members first.
 */
import { NextResponse } from "next/server";
import { requireHouseholdAdmin } from "@/lib/household/auth-guard";
import {
  getHousehold,
  listHouseholdMembers,
  listHouseholdPayments,
  updateHousehold,
} from "@/lib/household/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireHouseholdAdmin({ requireHouseholdMode: true });
  if (guard.error) return guard.error;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  const locationId = guard.session.user.locationId;
  const row = await getHousehold(locationId, id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const [members, payments] = await Promise.all([
    listHouseholdMembers(locationId, id),
    listHouseholdPayments(id, { limit: 1000 }),
  ]);
  return NextResponse.json({ household: row, members, payments });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireHouseholdAdmin({ requireHouseholdMode: true });
  if (guard.error) return guard.error;
  const { id: idStr } = await params;
  const id = Number(idStr);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {}
  const allowed = [
    "displayName",
    "externalId",
    "membershipTier",
    "mailLabel",
    "mailAddress1",
    "mailAddress2",
    "mailCity",
    "mailState",
    "mailZip",
    "mailCountry",
    "householdPhone",
    "householdEmail",
    "notes",
  ] as const;
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (k in body) patch[k] = body[k];
  }
  const row = await updateHousehold(
    guard.session.user.locationId,
    id,
    patch as never,
  );
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ household: row });
}
