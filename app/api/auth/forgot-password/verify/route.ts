import { NextRequest, NextResponse } from "next/server";
import { verifyResetCode, PasswordResetError } from "@/lib/auth/password-reset";

// Step 2: check the 6-digit code. Does not consume it, so the UI can advance to
// the new-password step; the code is consumed only on a successful reset.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    await verifyResetCode(String(body?.email ?? ""), String(body?.code ?? ""));
    return NextResponse.json({ valid: true });
  } catch (err) {
    if (err instanceof PasswordResetError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("[forgot-password/verify]", err);
    return NextResponse.json({ message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
