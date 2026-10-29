import { NextRequest, NextResponse } from "next/server";
import { requestPasswordReset, PasswordResetError } from "@/lib/auth/password-reset";

// Step 1: the user submits their email. If no DonorHQ account exists we say so
// (as requested); otherwise a 6-digit code is emailed via the GHL workflow.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const result = await requestPasswordReset(String(body?.email ?? ""));
    if (!result.exists) {
      return NextResponse.json(
        { exists: false, message: "No DonorHQ account exists for this email." },
        { status: 404 },
      );
    }
    return NextResponse.json({ exists: true, sent: true });
  } catch (err) {
    if (err instanceof PasswordResetError) {
      return NextResponse.json({ message: err.message }, { status: err.status });
    }
    console.error("[forgot-password/request]", err);
    return NextResponse.json({ message: "Something went wrong. Please try again." }, { status: 500 });
  }
}
