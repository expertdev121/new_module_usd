/**
 * Persistence layer for the FundRazr connection row.
 *
 * One row per DonorHQ location. No secrets stored — auth against
 * ConnectionPoint is a server-wide bearer token in env. This module
 * only tracks which ConnectionPoint organization the admin mapped
 * their location to.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  fundrazrConnections,
  type FundrazrConnection,
} from "@/lib/db/schema-fundrazr";

export type FundrazrConnectionStatus = "active" | "disconnected";

export async function getConnectionForLocation(
  locationId: string,
): Promise<FundrazrConnection | null> {
  const rows = await db
    .select()
    .from(fundrazrConnections)
    .where(eq(fundrazrConnections.locationId, locationId))
    .limit(1);
  return rows[0] ?? null;
}

export interface UpsertConnectionInput {
  locationId: string;
  organizationId: string;
  organizationName?: string | null;
  createdBy?: number | null;
}

export async function upsertConnection(input: UpsertConnectionInput) {
  const now = new Date();
  const [row] = await db
    .insert(fundrazrConnections)
    .values({
      locationId: input.locationId,
      organizationId: input.organizationId,
      organizationName: input.organizationName ?? null,
      status: "active",
      lastValidatedAt: now,
      createdBy: input.createdBy ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: fundrazrConnections.locationId,
      set: {
        organizationId: input.organizationId,
        organizationName: input.organizationName ?? null,
        status: "active",
        lastValidatedAt: now,
        updatedAt: now,
      },
    })
    .returning();
  return row;
}

export async function markDisconnected(locationId: string) {
  await db
    .update(fundrazrConnections)
    .set({ status: "disconnected", updatedAt: new Date() })
    .where(
      and(
        eq(fundrazrConnections.locationId, locationId),
        eq(fundrazrConnections.status, "active"),
      ),
    );
}

/** Shape returned to the client — no server-side secrets exist to strip. */
export function sanitizeForClient(conn: FundrazrConnection) {
  return {
    organizationId: conn.organizationId,
    organizationName: conn.organizationName,
    status: conn.status as FundrazrConnectionStatus,
    lastValidatedAt: conn.lastValidatedAt,
    updatedAt: conn.updatedAt,
  };
}
