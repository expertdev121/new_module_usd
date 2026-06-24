/**
 * Helper to gate admin Crowded endpoints. Same shape as
 * lib/offboard/auth-guard.ts so the calling pattern stays consistent.
 *
 * Usage:
 *   const guard = await requireCrowdedAdmin();
 *   if (guard.error) return guard.error;
 *   const locationId = guard.session.user.locationId; // narrowed non-null
 */
import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";

export interface AdminGuardOk {
  error: null;
  session: Session & { user: { locationId: string } };
}
export interface AdminGuardFail {
  error: NextResponse;
  session: null;
}

export async function requireCrowdedAdmin(): Promise<AdminGuardOk | AdminGuardFail> {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return {
      error: NextResponse.json(
        { error: "unauthorized", message: "Sign in required" },
        { status: 401 },
      ),
      session: null,
    };
  }
  if (session.user.role !== "admin" && session.user.role !== "super_admin") {
    return {
      error: NextResponse.json(
        { error: "forbidden", message: "Admins only" },
        { status: 403 },
      ),
      session: null,
    };
  }
  if (!session.user.locationId) {
    return {
      error: NextResponse.json(
        {
          error: "missing_location",
          message:
            "Your session has no locationId. Crowded is a per-location integration — contact support.",
        },
        { status: 400 },
      ),
      session: null,
    };
  }
  return {
    error: null,
    session: session as AdminGuardOk["session"],
  };
}
