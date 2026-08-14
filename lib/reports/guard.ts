/**
 * Shared security guard for every report API route (Phase 0 hotfix).
 *
 * 1. Tenant scoping is decided SERVER-SIDE from the session. Any
 *    locationId arriving in the request body is ignored for admins and
 *    regular users — only super_admin may pass an explicit override
 *    (they legitimately work across tenants).
 * 2. Boundary validators for values that end up inside SQL. Report
 *    routes historically interpolate strings into raw SQL; with these
 *    whitelist validators the interpolated values cannot carry SQL.
 */
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";

export interface ReportContext {
  locationId: string;
  role: string;
  email: string | null;
}

export async function getReportContext(
  bodyLocationId?: unknown,
): Promise<{ ctx: ReportContext; error: null } | { ctx: null; error: NextResponse }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  const role = session.user.role ?? "user";
  if (role !== "admin" && role !== "super_admin") {
    return {
      ctx: null,
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }

  let locationId: string | null = null;
  if (role === "super_admin") {
    // Super admins may target any tenant; fall back to their own.
    const override = typeof bodyLocationId === "string" ? bodyLocationId.trim() : "";
    locationId = override || session.user.locationId || null;
  } else {
    // Admins are HARD-LOCKED to their session tenant. Body value ignored.
    locationId = session.user.locationId || null;
  }

  if (!locationId || !/^[A-Za-z0-9_-]{1,64}$/.test(locationId)) {
    return {
      ctx: null,
      error: NextResponse.json(
        { error: "missing_location", message: "No valid locationId on your session." },
        { status: 400 },
      ),
    };
  }
  return { ctx: { locationId, role, email: session.user.email ?? null }, error: null };
}

/** Strict YYYY-MM-DD. Returns the validated string or null. */
export function safeDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isNaN(d.getTime()) ? null : s;
}

/** Finite number or null. */
export function safeNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Positive integer (ids, page, pageSize) or null. */
export function safeInt(v: unknown): number | null {
  const n = safeNumber(v);
  return n != null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** 400 helper for invalid filter input. */
export function badFilter(field: string): NextResponse {
  return NextResponse.json(
    { error: "invalid_filter", message: `Invalid value for ${field}.` },
    { status: 400 },
  );
}
