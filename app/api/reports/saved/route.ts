/**
 * Saved report views (Phase 4).
 *   GET    /api/reports/saved?reportKey=  — list saved views for the tenant
 *   POST   /api/reports/saved             — { reportKey, name, params }
 *   DELETE /api/reports/saved?id=          — remove one
 * Tenant-scoped through the report guard.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { savedReports } from "@/lib/db/schema-reports";
import { getReportContext, safeInt } from "@/lib/reports/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guard = await getReportContext();
  if (guard.error) return guard.error;
  const reportKey = searchParams.get("reportKey");
  const where = reportKey
    ? and(eq(savedReports.locationId, guard.ctx.locationId), eq(savedReports.reportKey, reportKey))
    : eq(savedReports.locationId, guard.ctx.locationId);
  const rows = await db.select().from(savedReports).where(where).orderBy(desc(savedReports.updatedAt)).limit(200);
  return NextResponse.json({ saved: rows });
}

export async function POST(request: NextRequest) {
  const guard = await getReportContext();
  if (guard.error) return guard.error;
  let body: { reportKey?: string; name?: string; params?: unknown } = {};
  try { body = await request.json(); } catch {}
  const reportKey = String(body.reportKey || "").trim().slice(0, 64);
  const name = String(body.name || "").trim().slice(0, 120);
  if (!reportKey || !name || typeof body.params !== "object" || body.params == null) {
    return NextResponse.json({ error: "invalid_request", message: "reportKey, name and params are required." }, { status: 400 });
  }
  const [row] = await db.insert(savedReports).values({
    locationId: guard.ctx.locationId,
    reportKey, name,
    params: body.params,
  }).returning();
  return NextResponse.json({ saved: row });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guard = await getReportContext();
  if (guard.error) return guard.error;
  const id = safeInt(searchParams.get("id"));
  if (id == null) return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  await db.delete(savedReports).where(
    and(eq(savedReports.id, id), eq(savedReports.locationId, guard.ctx.locationId)),
  );
  return NextResponse.json({ ok: true });
}
