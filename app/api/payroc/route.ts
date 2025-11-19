import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

// Payroc Configuration (Sandbox)
const PAYROC_CONFIG = {
  MERCHANT_ID: "6077",
  TERMINAL_ID: "6077001",
  API_KEY: "6YjWeCAyZGj.R8$GN7S&N0D%XZG879@PGOPR@HJZEO",

  // ✔ Correct endpoint (NOT /connect/token)
  IDENTITY_URL: "https://identity.uat.payroc.com/authorize",

  API_BASE_URL: "https://api.uat.payroc.com",

  HOSTED_FIELDS_SCRIPT:
    "https://cdn.uat.payroc.com/js/hosted-fields/hosted-fields-1.6.0.172429.js",
  LIB_VERSION: "1.6.0.172429",
};

// ------------------------------------------------------
// GET — send config to frontend
// ------------------------------------------------------
export async function GET() {
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
}

// ------------------------------------------------------
// POST — Process Payroc Payment
// ------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const { token, amount, currency, paymentData } = await request.json();

    if (!token || !amount || !currency) {
      return NextResponse.json(
        { error: "Missing required fields: token, amount, currency" },
        { status: 400 }
      );
    }

    console.log("📌 Step 1: Requesting Payroc access token using x-api-key…");

    // ------------------------------------------------------
    // 1️⃣ GET ACCESS TOKEN (x-api-key ONLY — NO OAUTH)
    // ------------------------------------------------------
    const authResponse = await fetch(PAYROC_CONFIG.IDENTITY_URL, {
      method: "POST",
      headers: {
        "x-api-key": PAYROC_CONFIG.API_KEY,
        Accept: "application/json",
        "User-Agent": "Givesuite/1.0",
      },
    });

    const authText = await authResponse.text();

    if (!authResponse.ok) {
      console.error("❌ Payroc Auth Error:", authText);
      return NextResponse.json(
        { error: "Authentication failed", details: authText },
        { status: authResponse.status }
      );
    }

    const { access_token } = JSON.parse(authText);

    console.log("✔ Access Token Received:", access_token);

    // ------------------------------------------------------
    // 2️⃣ PROCESS PAYMENT USING hostedFieldsToken
    // ------------------------------------------------------
    console.log("📌 Step 2: Sending payment to Payroc…");

    const paymentResponse = await fetch(
      `${PAYROC_CONFIG.API_BASE_URL}/v1/payments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Idempotency-Key": randomUUID(),
        },
        body: JSON.stringify({
          amount: amount.toFixed(2),
          currencyCode: currency,

          paymentMethod: {
            hostedFieldsToken: token, // ✔ Correct field name
          },

          metadata: {
            ...paymentData,
            publicFormData: {
              firstName: paymentData?.firstName,
              lastName: paymentData?.lastName,
              email: paymentData?.email,
            },
          },
        }),
      }
    );

    const paymentText = await paymentResponse.text();

    if (!paymentResponse.ok) {
      console.error("❌ Payroc Payment Error:", paymentText);
      return NextResponse.json(
        { error: "Payment processing failed", details: paymentText },
        { status: paymentResponse.status }
      );
    }

    const paymentResult = JSON.parse(paymentText);

    console.log("✔ Payment Success:", paymentResult);

    // ------------------------------------------------------
    // 3️⃣ SUCCESS
    // ------------------------------------------------------
    return NextResponse.json({
      success: true,
      paymentId: paymentResult.id,
      status: paymentResult.status,
      transactionId: paymentResult.transactionId,
      amount: paymentResult.amount,
      currency: paymentResult.currency,
    });
  } catch (error) {
    console.error("❌ Unexpected error in Payroc payment:", error);
    return NextResponse.json(
      { error: "Payment processing failed" },
      { status: 500 }
    );
  }
}
