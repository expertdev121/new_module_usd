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

  // Per-location health metrics (last 24h):
  //   total events, processed count, failed/skipped count, success rate %,
  //   last received timestamp, last error message (if any).
  // Lets you watch sync health at scale — spot a sub-account whose webhooks
  // are failing while others succeed.
  const perLocationHealthRaw = (await db
    .select({
      locationId: ghlWebhookEvents.locationId,
      total: sql<number>`COUNT(*)::int`,
      processed: sql<number>`COUNT(*) FILTER (WHERE ${ghlWebhookEvents.processingStatus} = 'processed')::int`,
      duplicate: sql<number>`COUNT(*) FILTER (WHERE ${ghlWebhookEvents.processingStatus} = 'duplicate')::int`,
      failed: sql<number>`COUNT(*) FILTER (WHERE ${ghlWebhookEvents.processingStatus} = 'failed')::int`,
      skipped_no_token: sql<number>`COUNT(*) FILTER (WHERE ${ghlWebhookEvents.processingStatus} = 'skipped_no_token')::int`,
      skipped_loop: sql<number>`COUNT(*) FILTER (WHERE ${ghlWebhookEvents.processingStatus} = 'skipped_loop')::int`,
      unknown_type: sql<number>`COUNT(*) FILTER (WHERE ${ghlWebhookEvents.processingStatus} = 'unknown_type')::int`,
      lastReceivedAt: sql<string>`MAX(${ghlWebhookEvents.receivedAt})::text`,
      lastError: sql<string | null>`(
        SELECT processing_error FROM ghl_webhook_events e2
        WHERE e2.location_id = ${ghlWebhookEvents.locationId}
          AND e2.processing_status IN ('failed', 'skipped_no_token')
          AND e2.received_at > NOW() - INTERVAL '24 hours'
        ORDER BY e2.received_at DESC LIMIT 1
      )`,
    })
    .from(ghlWebhookEvents)
    .where(summaryWhere)
    .groupBy(ghlWebhookEvents.locationId)
    .orderBy(sql`COUNT(*) DESC`)) as Array<{
      locationId: string | null;
      total: number;
      processed: number;
      duplicate: number;
      failed: number;
      skipped_no_token: number;
      skipped_loop: number;
      unknown_type: number;
      lastReceivedAt: string;
      lastError: string | null;
    }>;

  const perLocationHealth = perLocationHealthRaw.map((r) => {
    // success = processed + duplicate + skipped_loop (all benign outcomes)
    // problem = failed + skipped_no_token + unknown_type
    const successCount = r.processed + r.duplicate + r.skipped_loop;
    const problemCount = r.failed + r.skipped_no_token + r.unknown_type;
    const successRate =
      r.total > 0 ? Math.round((successCount / r.total) * 100) : 0;
    return {
      locationId: r.locationId,
      total: r.total,
      processed: r.processed,
      duplicate: r.duplicate,
      failed: r.failed,
      skippedNoToken: r.skipped_no_token,
      skippedLoop: r.skipped_loop,
      unknownType: r.unknown_type,
      successRate,
      lastReceivedAt: r.lastReceivedAt,
      lastError: r.lastError,
      health:
        problemCount === 0
          ? ("healthy" as const)
          : successRate >= 80
            ? ("degraded" as const)
            : ("unhealthy" as const),
    };
  });

  return NextResponse.json({
    summary: {
      window: "last 24 hours",
      total,
      byStatus,
      byEventType,
      byLocation,
    },
    perLocationHealth,
    events: safeEvents,
    filters: { eventType, status, locationId, limit },
  });
}
