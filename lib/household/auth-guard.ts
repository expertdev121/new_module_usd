/**
 * Admin gate for household endpoints. Mirrors requireCrowdedAdmin.
 * Also refuses when the tenant is not in household mode, so an admin
 * of an individual-mode tenant can't accidentally touch this data.
 */
import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAccountType } from "@/lib/household/location-mode";

export interface HouseholdGuardOk {
  error: null;
  session: Session & { user: { locationId: string } };
}
export interface HouseholdGuardFail {
  error: NextResponse;
  session: null;
}

export async function requireHouseholdAdmin(opts: {
  requireHouseholdMode?: boolean;
} = {}): Promise<HouseholdGuardOk | HouseholdGuardFail> {
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
        { error: "missing_location", message: "Session has no locationId." },
        { status: 400 },
      ),
      session: null,
    };
  }
  if (opts.requireHouseholdMode) {
    const acct = await getAccountType(session.user.locationId);
    if (acct !== "household") {
      return {
        error: NextResponse.json(
          {
            error: "wrong_mode",
            message:
              "This tenant is not in household mode. A super-admin must switch it before this endpoint is available.",
          },
          { status: 409 },
        ),
        session: null,
      };
    }
  }
  return { error: null, session: session as HouseholdGuardOk["session"] };
}
