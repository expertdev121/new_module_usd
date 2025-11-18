import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

// Payroc Hosted Fields Configuration (Sandbox)
const PAYROC_CONFIG = {
  MERCHANT_ID: "6077",
  TERMINAL_ID: "6077001",
  API_KEY: "6YjWeCAyZGj.R8$GN7S&N0D%XZG879@PGOPR@HJZEO",

  // ❗ FIXED: Use correct OAuth token endpoint
  IDENTITY_URL: "https://identity.uat.payroc.com/connect/token",

  API_BASE_URL: "https://api.uat.payroc.com",
  HOSTED_FIELDS_SCRIPT:
    "https://cdn.uat.payroc.com/js/hosted-fields/hosted-fields-1.6.0.172429.js",
  LIB_VERSION: "1.6.0.172429",
};

// Get Payroc configuration for frontend
export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({
      config: {
        merchantId: PAYROC_CONFIG.MERCHANT_ID,
        terminalId: PAYROC_CONFIG.TERMINAL_ID,
        apiKey: PAYROC_CONFIG.API_KEY,
        identityUrl: PAYROC_CONFIG.IDENTITY_URL,
        apiBaseUrl: PAYROC_CONFIG.API_BASE_URL,
        hostedFieldsScript: PAYROC_CONFIG.HOSTED_FIELDS_SCRIPT,
        libVersion: PAYROC_CONFIG.LIB_VERSION,
      },
    });
  } catch (error) {
    console.error("Error in Payroc GET:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// Process Payroc Hosted Fields Payment
export async function POST(request: NextRequest) {
  try {
    const { token, amount, currency, paymentData } = await request.json();

    if (!token || !amount || !currency) {
      return NextResponse.json(
        { error: "Missing required fields: token, amount, currency" },
        { status: 400 }
      );
    }

    // ------------------------------------------
    // 1. Authenticate using OAuth Client Credentials
    // ------------------------------------------
    const body = new URLSearchParams();
    body.append("grant_type", "client_credentials");
    body.append("client_id", PAYROC_CONFIG.MERCHANT_ID);
    body.append("client_secret", PAYROC_CONFIG.API_KEY);
    body.append("scope", "payrocapi");

    const authRes = await fetch(PAYROC_CONFIG.IDENTITY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body.toString(),
    });

    if (!authRes.ok) {
      const err = await authRes.text();
      console.error("Payroc Auth Error:", err);
      return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
    }

    const { access_token } = await authRes.json();

    // ------------------------------------------
    // 2. Send Hosted Fields token to Payroc /v1/payments
    // ------------------------------------------
    const payRes = await fetch(`${PAYROC_CONFIG.API_BASE_URL}/v1/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Idempotency-Key": randomUUID(),
        "User-Agent": "Givesuite/1.0",
      },
      body: JSON.stringify({
        amount: amount.toFixed(2),
        currencyCode: currency,

        paymentMethod: {
          // ❗ FIXED: CORRECT FIELD NAME FOR HOSTED FIELDS
          hostedFieldsToken: token,
        },

        metadata: paymentData || {},
      }),
    });

    if (!payRes.ok) {
      const errorData = await payRes.json();
      console.error("Payroc Payment API error:", errorData);

      return NextResponse.json(
        { error: "Payment processing failed", details: errorData },
        { status: payRes.status }
      );
    }

    const result = await payRes.json();

    // ------------------------------------------
    // 3. SUCCESS
    // ------------------------------------------
    return NextResponse.json({
      success: true,
      paymentId: result.id,
      status: result.status,
      transactionId: result.transactionId,
      amount: result.amount,
      currency: result.currency,
    });
  } catch (error) {
    console.error("Error processing Payroc payment:", error);
    return NextResponse.json(
      { error: "Payment processing failed" },
      { status: 500 }
    );
  }
}
