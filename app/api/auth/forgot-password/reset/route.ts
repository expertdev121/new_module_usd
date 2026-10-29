import { NextRequest, NextResponse } from "next/server";
import { resetPassword, PasswordResetError } from "@/lib/auth/password-reset";

// Step 3: re-check the code and set the new password. On success the code (and
// any siblings) are consumed so they cannot be reused.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    await resetPassword(
      String(body?.email ?? ""),
      String(body?.code ?? ""),
      String(body?.newPassword ?? ""),
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof PasswordResetError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("[forgot-password/reset]", err);
    return NextResponse.json({ message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
