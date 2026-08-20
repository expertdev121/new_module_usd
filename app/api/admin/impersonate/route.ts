/**
 * POST /api/admin/impersonate — server-side validation + audit for a super
 * admin switching into (or out of) a client account.
 *
 *   body { locationId: "<tenant>" }  → start impersonating that tenant
 *   body { locationId: null }        → stop (return to super admin)
 *
 * This route does NOT mutate the JWT itself (that happens client-side via
 * useSession().update, which the jwt() callback enforces on realRole). Its
 * jobs are: (1) confirm the caller is genuinely a super admin, (2) confirm the
 * target tenant exists, (3) write the audit-log entry attributed to the real
 * super admin. The token swap is meaningless without a valid super admin, so
 * both layers must agree.
 */
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { organizationName } from "@/lib/db/schema";
import { logAudit } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  // Enforce on the REAL role: a super admin who is already impersonating has
  // role === "admin" but realRole === "super_admin", and must still be allowed
  // to switch tenants or return.
  const realRole = session?.user?.realRole ?? session?.user?.role;
  if (!session?.user || realRole !== "super_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: { locationId?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const superAdminEmail = session.user.email;

  // Stop impersonating.
  if (!body.locationId) {
    await logAudit(
      "IMPERSONATION_STOP",
      { fromLocationId: session.user.impersonatedLocationId ?? session.user.locationId ?? null },
      superAdminEmail,
      session.user.realLocationId ?? undefined,
    );
    return NextResponse.json({ ok: true });
  }

  // Start impersonating — the target tenant must exist.
  const [org] = await db
    .select({ orgName: organizationName.orgName })
    .from(organizationName)
    .where(eq(organizationName.locationId, body.locationId))
    .limit(1);
  if (!org) {
    return NextResponse.json({ error: "unknown_tenant" }, { status: 404 });
  }

  await logAudit(
    "IMPERSONATION_START",
    { targetLocationId: body.locationId, targetOrgName: org.orgName },
    superAdminEmail,
    session.user.realLocationId ?? undefined,
  );

  return NextResponse.json({ ok: true, orgName: org.orgName });
}
