/**
 * GET /api/admin/ghl-webhook-logs
 *
 * Super-admin-only view of every webhook GHL has ever fired at us, plus
 * summary stats. Filterable by:
 *   ?eventType=ContactCreate
 *   ?status=processed | failed | skipped_no_token | skipped_loop | unknown_type | received | duplicate
 *   ?locationId=...
 *   ?limit=200 (default 100, max 500)
 *
 * Response shape:
 *   {
 *     summary: {
 *       total: number,
 *       byStatus: { processed: N, failed: N, ... },
 *       byEventType: { ContactCreate: N, ... },
 *       byLocation: { "<locId>": N, ... }
 *     },
 *     events: [
 *       {
 *         id, webhookId (first 12 chars only), eventType, locationId,
 *         companyId, signatureValid, processingStatus, processingError,
 *         receivedAt, processedAt, durationMs
 *       }
 *     ]
 *   }
 */
import { NextResponse, type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { ghlWebhookEvents } from "@/lib/db/schema-webhook";
import { and, eq, desc, sql, gte } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401 },
    );
  }
  // Super-admin gate. Regular admins shouldn't see other locations' events.
  if (session.user.role !== "super_admin") {
    return NextResponse.json(
      { error: "forbidden", message: "Super admin only" },
      { status: 403 },
    );
  }

  const params = req.nextUrl.searchParams;
  const eventType = params.get("eventType");
  const status = params.get("status");
  const locationId = params.get("locationId");
  const limit = Math.min(
    Math.max(parseInt(params.get("limit") || "100", 10) || 100, 1),
    500,
  );

  // Build WHERE clause.
  const filters = [];
  if (eventType) filters.push(eq(ghlWebhookEvents.eventType, eventType));
  if (status) filters.push(eq(ghlWebhookEvents.processingStatus, status));
  if (locationId) filters.push(eq(ghlWebhookEvents.locationId, locationId));

  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const events = await db
    .select({
      id: ghlWebhookEvents.id,
      webhookId: ghlWebhookEvents.webhookId,
      eventType: ghlWebhookEvents.eventType,
      locationId: ghlWebhookEvents.locationId,
      companyId: ghlWebhookEvents.companyId,
      signatureValid: ghlWebhookEvents.signatureValid,
      processingStatus: ghlWebhookEvents.processingStatus,
      processingError: ghlWebhookEvents.processingError,
      receivedAt: ghlWebhookEvents.receivedAt,
      processedAt: ghlWebhookEvents.processedAt,
    })
    .from(ghlWebhookEvents)
    .where(whereClause)
    .orderBy(desc(ghlWebhookEvents.receivedAt))
    .limit(limit);

  // Mask webhookId to first 12 chars (privacy in the UI).
  const safeEvents = events.map((e) => ({
    ...e,
    webhookId: e.webhookId.slice(0, 12),
    processingError: e.processingError ?? null,
    durationMs:
      e.processedAt && e.receivedAt
        ? e.processedAt.getTime() - e.receivedAt.getTime()
        : null,
  }));

  // Summary stats — last 24h only so the page loads quickly.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const summaryWhere = and(gte(ghlWebhookEvents.receivedAt, yesterday));

  const [byStatusRows, byEventRows, byLocRows] = await Promise.all([
    db
      .select({
        status: ghlWebhookEvents.processingStatus,
        c: sql<number>`COUNT(*)::int`,
      })
      .from(ghlWebhookEvents)
      .where(summaryWhere)
      .groupBy(ghlWebhookEvents.processingStatus),
    db
      .select({
        eventType: ghlWebhookEvents.eventType,
        c: sql<number>`COUNT(*)::int`,
      })
      .from(ghlWebhookEvents)
      .where(summaryWhere)
      .groupBy(ghlWebhookEvents.eventType),
    db
      .select({
        locationId: ghlWebhookEvents.locationId,
        c: sql<number>`COUNT(*)::int`,
      })
      .from(ghlWebhookEvents)
      .where(summaryWhere)
      .groupBy(ghlWebhookEvents.locationId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(20),
  ]);

  const total = byStatusRows.reduce((sum, r) => sum + r.c, 0);
  const byStatus: Record<string, number> = {};
  byStatusRows.forEach((r) => (byStatus[r.status] = r.c));
  const byEventType: Record<string, number> = {};
  byEventRows.forEach((r) => (byEventType[r.eventType] = r.c));
  const byLocation: Record<string, number> = {};
  byLocRows.forEach((r) => (byLocation[r.locationId ?? "(none)"] = r.c));

  return NextResponse.json({
    summary: {
      window: "last 24 hours",
      total,
      byStatus,
      byEventType,
      byLocation,
    },
    events: safeEvents,
    filters: { eventType, status, locationId, limit },
  });
}
