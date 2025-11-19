import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

const PAYROC_CONFIG = {
  MERCHANT_ID: "6077",
  TERMINAL_ID: "6077001",
  API_KEY: "6YjWeCAyZGj.R8$GN7S&N0D%XZG879@PGOPR@HJZEO",
  IDENTITY_URL: "https://identity.uat.payroc.com/authorize",
  API_BASE_URL: "https://api.uat.payroc.com",
  LIB_VERSION: "1.6.0.172429",
  HOSTED_FIELDS_SCRIPT:
    "https://cdn.uat.payroc.com/js/hosted-fields/hosted-fields-1.6.0.172429.js",
};

export async function POST(request: NextRequest) {
  try {
    console.log("🔑 Requesting Payroc Access Token via x-api-key…");

    // 1️⃣ Get access token using x-api-key (NO CONTENT-TYPE)
    const tokenResponse = await fetch(PAYROC_CONFIG.IDENTITY_URL, {
      method: "POST",
      headers: {
        "x-api-key": PAYROC_CONFIG.API_KEY,
        Accept: "application/json",
        "User-Agent": "Givesuite/1.0",
      },
    });

    const tokenText = await tokenResponse.text();
    console.log("🔍 Raw Token Response:", tokenText);

    if (!tokenResponse.ok) {
      console.error("❌ Payroc Identity Service error:", tokenText);
      return NextResponse.json(
        { error: "Failed to get bearer token", details: tokenText },
        { status: tokenResponse.status }
      );
    }

    const tokenData = JSON.parse(tokenText);

    // IMPORTANT: Payroc returns { token: "..." }
    const accessToken = tokenData.token;

    if (!accessToken) {
      console.error("❌ No token found in Payroc response:", tokenData);
      return NextResponse.json(
        { error: "Invalid Payroc token response", details: tokenData },
        { status: 500 }
      );
    }

    console.log("✔ Access Token:", accessToken);

    // 2️⃣ Create hosted fields session
    console.log("🧪 Creating Payroc Hosted Fields session…");

    const sessionResponse = await fetch(
      `${PAYROC_CONFIG.API_BASE_URL}/v1/processing-terminals/${PAYROC_CONFIG.TERMINAL_ID}/hosted-fields-sessions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": "Givesuite/1.0",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          libVersion: PAYROC_CONFIG.LIB_VERSION,
          scenario: "payment",
        }),
      }
    );

    const sessionText = await sessionResponse.text();
    console.log("🔍 Hosted Fields Raw Response:", sessionText);

    if (!sessionResponse.ok) {
      console.error("❌ Payroc Hosted Fields Session ERROR:", sessionText);
      return NextResponse.json(
        { error: "Failed to create hosted fields session", details: sessionText },
        { status: sessionResponse.status }
      );
    }

    const sessionJson = JSON.parse(sessionText);

    return NextResponse.json({
      sessionToken: sessionJson.token,
      expiresAt: sessionJson.expiresAt,
    });
  } catch (err: any) {
    console.error("💥 UNHANDLED ERROR creating Payroc session:", err);
    return NextResponse.json(
      { error: "Failed to create hosted fields session", details: err.message },
      { status: 500 }
    );
  }
}
