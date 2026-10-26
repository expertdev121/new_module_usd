/**
 * Gate for /api/admin/accounting/* — admins only, scoped to the session's location.
 * Same shape as lib/stripe-connect/auth-guard.ts.
 *
 *   const guard = await requireAccountingAdmin();
 *   if (guard.error) return guard.error;
 *   const { locationId } = guard.session.user;
 */
import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";

export interface AccountingGuardOk {
  error: null;
  session: Session & { user: { locationId: string } };
  userId: number | null;
}
export interface AccountingGuardFail {
  error: NextResponse;
  session: null;
  userId: null;
}

export async function requireAccountingAdmin(): Promise<AccountingGuardOk | AccountingGuardFail> {
  const session = await getServerSession(authOptions);
  const fail = (status: number, error: string, message: string): AccountingGuardFail => ({
    error: NextResponse.json({ error, message }, { status }),
    session: null,
    userId: null,
  });

  if (!session?.user) return fail(401, "unauthorized", "Sign in required");
  if (session.user.role !== "admin" && session.user.role !== "super_admin") {
    return fail(403, "forbidden", "Admins only");
  }
  if (!session.user.locationId) {
    return fail(400, "missing_location", "Your session has no locationId. Accounting is per-location.");
  }
  const parsed = Number.parseInt(String(session.user.id ?? ""), 10);
  return {
    error: null,
    session: session as AccountingGuardOk["session"],
    userId: Number.isFinite(parsed) ? parsed : null,
  };
}
