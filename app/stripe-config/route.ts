import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  if (!process.env.STRIPE_PUBLISHABLE_KEY) {
    return NextResponse.json(
      { error: "Missing STRIPE_PUBLISHABLE_KEY" },
      { status: 500 }
    );
  }

  if (process.env.STRIPE_PUBLISHABLE_KEY.startsWith("sk_")) {
    return NextResponse.json(
      {
        error:
          "Invalid STRIPE_PUBLISHABLE_KEY. Stripe.js requires a publishable key starting with pk_.",
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
  });
}
