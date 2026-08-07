/**
 * GET /api/admin/households/search?q=<query>&limit=20
 *
 * Combobox source for the "Attach to household" picker on the contact
 * detail page. Fuzzy prefix match on display_name + external_id.
 * Household-mode only.
 */
import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireHouseholdAdmin } from "@/lib/household/auth-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const guard = await requireHouseholdAdmin({ requireHouseholdMode: true });
  if (guard.error) return guard.error;
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "20"), 50);
  const locationId = guard.session.user.locationId;

  const pattern = `%${q}%`;
  const result = await db.execute<{
    id: number;
    display_name: string;
    external_id: string | null;
    membership_tier: string | null;
    mail_city: string | null;
    mail_state: string | null;
    member_count: string;
  }>(sql`
    SELECT h.id, h.display_name, h.external_id, h.membership_tier,
           h.mail_city, h.mail_state,
           COALESCE((SELECT COUNT(*)::text FROM contact c WHERE c.household_id = h.id), '0') AS member_count
    FROM household h
    WHERE h.location_id = ${locationId}
    ${q
      ? sql`AND (h.display_name ILIKE ${pattern} OR h.external_id ILIKE ${pattern} OR h.mail_label ILIKE ${pattern})`
      : sql``}
    ORDER BY h.display_name ASC
    LIMIT ${limit}
  `);
  const rows = (result as unknown as { rows?: unknown[] }).rows ??
    (result as unknown as unknown[]);
  return NextResponse.json({
    households: (rows as Array<{
      id: number; display_name: string; external_id: string | null;
      membership_tier: string | null; mail_city: string | null;
      mail_state: string | null; member_count: string;
    }>).map(r => ({
      id: r.id,
      displayName: r.display_name,
      externalId: r.external_id,
      membershipTier: r.membership_tier,
      mailCity: r.mail_city,
      mailState: r.mail_state,
      memberCount: Number(r.member_count),
    })),
  });
}
