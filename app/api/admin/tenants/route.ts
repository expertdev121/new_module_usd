/**
 * GET /api/admin/tenants — the list of all client accounts a super admin can
 * switch into. Super-admin ONLY, enforced on the REAL role so it stays
 * available even while already impersonating (to switch to another tenant or
 * back). Returns [{ locationId, orgName }] sorted by name.
 */
import { NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationName } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const realRole = session?.user?.realRole ?? session?.user?.role;
  if (!session?.user || realRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tenants = await db
    .select({ locationId: organizationName.locationId, orgName: organizationName.orgName })
    .from(organizationName)
    .orderBy(asc(organizationName.orgName));

  return NextResponse.json({ tenants });
}
