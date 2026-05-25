/**
 * Helper to gate offboarding endpoints to super_admin only.
 *
 * Usage:
 *   const { error, session } = await requireSuperAdmin();
 *   if (error) return error;          // 401 or 403 response
 *   // ... use session.user.email etc
 */
import { NextResponse } from "next/server";
import { getServerSession, type Session } from "next-auth";
import { authOptions } from "@/lib/auth";

export interface RequireSuperAdminOk {
  error: null;
  session: Session;
}

export interface RequireSuperAdminFail {
  error: NextResponse;
  session: null;
}

export async function requireSuperAdmin(): Promise<
  RequireSuperAdminOk | RequireSuperAdminFail
> {
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
  if (session.user.role !== "super_admin") {
    return {
      error: NextResponse.json(
        { error: "forbidden", message: "Super admin only" },
        { status: 403 },
      ),
      session: null,
    };
  }
  return { error: null, session };
}
