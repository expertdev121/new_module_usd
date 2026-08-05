/**
 * GET  /api/admin/households — list households for the current tenant.
 *      Query: ?search=&limit=&offset=
 * POST /api/admin/households — create a new household.
 *
 * Both require household mode to be on.
 */
import { NextResponse } from "next/server";
import { requireHouseholdAdmin } from "@/lib/household/auth-guard";
import { createHousehold, listHouseholds } from "@/lib/household/repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireHouseholdAdmin({ requireHouseholdMode: true });
  if (guard.error) return guard.error;
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? undefined;
  const limit = Number(url.searchParams.get("limit") ?? "100");
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const rows = await listHouseholds(guard.session.user.locationId, {
    search,
    limit,
    offset,
  });
  return NextResponse.json({ households: rows, count: rows.length });
}

export async function POST(req: Request) {
  const guard = await requireHouseholdAdmin({ requireHouseholdMode: true });
  if (guard.error) return guard.error;
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {}
  const displayName = String(body.displayName ?? "").trim();
  if (!displayName) {
    return NextResponse.json(
      { error: "invalid_request", message: "displayName is required." },
      { status: 400 },
    );
  }
  const row = await createHousehold({
    locationId: guard.session.user.locationId,
    displayName,
    externalId: (body.externalId as string) ?? null,
    membershipTier: (body.membershipTier as string) ?? null,
    mailLabel: (body.mailLabel as string) ?? null,
    mailAddress1: (body.mailAddress1 as string) ?? null,
    mailAddress2: (body.mailAddress2 as string) ?? null,
    mailCity: (body.mailCity as string) ?? null,
    mailState: (body.mailState as string) ?? null,
    mailZip: (body.mailZip as string) ?? null,
    mailCountry: (body.mailCountry as string) ?? null,
    householdPhone: (body.householdPhone as string) ?? null,
    householdEmail: (body.householdEmail as string) ?? null,
    notes: (body.notes as string) ?? null,
  });
  return NextResponse.json({ household: row });
}
