const PAYROC_CONFIG = {
  API_KEY: "6YjWeCAyZGj.R8$GN7S&N0D%XZG879@PGOPR@HJZEO",
  IDENTITY_URL: "https://identity.uat.payroc.com/authorize",
  API_BASE_URL: "https://api.uat.payroc.com",
  WEBHOOK_URL:  "https://abc123.ngrok.io/api/payroc/webhook"
};

async function getAccessToken(): Promise<string> {
  const authResponse = await fetch(PAYROC_CONFIG.IDENTITY_URL, {
    method: "POST",
    headers: {
      "x-api-key": PAYROC_CONFIG.API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!authResponse.ok) {
    throw new Error("Authentication failed");
  }

  const authData = await authResponse.json();
  return authData.access_token || authData.accessToken;
}

async function createEventSubscription() {
  try {
    console.log("🔐 Getting access token...");
    const accessToken = await getAccessToken();
    console.log("✅ Access token obtained");

    console.log("\n📡 Creating event subscription...");
    
    const subscriptionData = {
      url: PAYROC_CONFIG.WEBHOOK_URL,
      events: [
        "payment.approved",
        "payment.declined", 
        "payment.captured",
        "payment.refunded",
        "payment.expired",
        "payment.reversed",
        "payment.pending",
      ],
      description: "Payment notifications webhook",
      active: true,
    };

    console.log("📦 Subscription data:", JSON.stringify(subscriptionData, null, 2));

    const response = await fetch(
      `${PAYROC_CONFIG.API_BASE_URL}/v1/event-subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": PAYROC_CONFIG.API_KEY,
        },
        body: JSON.stringify(subscriptionData),
      }
    );

    const responseText = await response.text();
    console.log("\n📡 Response Status:", response.status);
    console.log("📄 Response:", responseText);

    if (response.ok) {
      const result = JSON.parse(responseText);
      console.log("\n✅ Event subscription created successfully!");
      console.log("🆔 Subscription ID:", result.subscriptionId || result.id);
      console.log("🔗 Webhook URL:", result.url);
      console.log("📋 Events:", result.events);
    } else {
      console.error("❌ Failed to create event subscription");
      console.error("Details:", responseText);
    }
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

// Run the script
createEventSubscription();
