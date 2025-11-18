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
    // 1️⃣ Get access token (NO CONTENT-TYPE, NO BODY)
    const tokenResponse = await fetch(PAYROC_CONFIG.IDENTITY_URL, {
      method: "POST",
      headers: {
        "x-api-key": PAYROC_CONFIG.API_KEY,
        "Accept": "application/json",
        "User-Agent": "Givesuite/1.0",
      },
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      console.error("Payroc Identity Service error:", text);
      return NextResponse.json(
        { error: "Failed to get bearer token", details: text },
        { status: tokenResponse.status }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // 2️⃣ Create hosted fields session
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

    const text = await sessionResponse.text();
    if (!sessionResponse.ok) {
      console.error("Payroc Hosted Fields Session error:", text);
      return NextResponse.json(
        { error: "Failed to create hosted fields session", details: text },
        { status: sessionResponse.status }
      );
    }

    const sessionJson = JSON.parse(text);

    return NextResponse.json({
      sessionToken: sessionJson.token,
      expiresAt: sessionJson.expiresAt,
    });
  } catch (err: any) {
    console.error("Error creating hosted fields session:", err);
    return NextResponse.json(
      { error: "Failed to create hosted fields session" },
      { status: 500 }
    );
  }
}
