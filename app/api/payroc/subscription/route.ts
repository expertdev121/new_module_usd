import { NextRequest, NextResponse } from "next/server";

// --- Configuration ---
// !!! IMPORTANT: These should ideally be loaded from environment variables (.env)
const PAYROC_CONFIG = {
  MERCHANT_ID: "6077",
  TERMINAL_ID: "6077001",
  API_KEY: "6YjWeCAyZGj.R8$GN7S&N0D%XZG879@PGOPR@HJZEO",

  IDENTITY_URL: "https://identity.uat.payroc.com/authorize",
  API_BASE_URL: "https://api.uat.payroc.com",

  // This URL MUST be publicly accessible and accept POST requests
  WEBHOOK_URL:" https://webhook.site/6b94386c-0909-467c-b947-d1e5da685b9f",

  // !!! IMPORTANT: REPLACE THIS with a unique, high-entropy secret you generate.
  // This exact string will be used by your webhook handler for verification.
  WEBHOOK_SECRET: "sec_W3bH00kT0K3n_A1ph4NuM3r1c_S3cr3t_789XYZ",
};

// Event string to subscribe to (must match Payroc's events list)
const EVENT_TYPES = ["payment.succeeded"];

export async function POST(request: NextRequest) {
  try {
    console.log("📌 Starting Payroc event subscription process…");

    // 1️⃣ GET ACCESS TOKEN (Bearer Token required for subscription API)
    const authResponse = await fetch(PAYROC_CONFIG.IDENTITY_URL, {
      method: "POST",
      headers: {
        "x-api-key": PAYROC_CONFIG.API_KEY,
        Accept: "application/json",
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
    console.log("✔ Access Token Received.");

    // 2️⃣ CREATE EVENT SUBSCRIPTION
    const subscriptionPayload = {
      enabled: true,
      eventTypes: EVENT_TYPES,
      notifications: [
        {
          type: "webhook",
          uri: PAYROC_CONFIG.WEBHOOK_URL,
          secret: PAYROC_CONFIG.WEBHOOK_SECRET, // Your generated secret is sent here
          supportEmailAddress: "support@yourdomain.com", // Replace with a real email
        },
      ],
    };

    const subscriptionResponse = await fetch(
      `${PAYROC_CONFIG.API_BASE_URL}/v1/event-subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(subscriptionPayload),
      }
    );

    const subscriptionText = await subscriptionResponse.text();

    if (!subscriptionResponse.ok) {
      console.error("❌ Subscription creation failed:", subscriptionText);
      return NextResponse.json(
        {
          error: "Subscription creation failed",
          details: subscriptionText,
          payload: subscriptionPayload
        },
        { status: subscriptionResponse.status }
      );
    }

    const subscriptionResult = JSON.parse(subscriptionText);
    console.log("✅ Subscription created successfully:", subscriptionResult);

    return NextResponse.json({
      success: true,
      message: "Webhook subscription registered with Payroc.",
      subscription: subscriptionResult,
      webhookUrl: PAYROC_CONFIG.WEBHOOK_URL,
    });
  } catch (error) {
    console.error("❌ Unexpected error in subscription creation:", error);
    return NextResponse.json(
      { error: "Subscription creation failed", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "Ready to create subscription",
    endpoint: "/api/create-subscription (POST)",
    nextSteps: "POST to this endpoint to register your webhook with Payroc UAT environment.",
  });
}