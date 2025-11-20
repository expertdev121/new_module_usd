import { NextRequest, NextResponse } from "next/server";

const PAYROC_CONFIG = {
  TERMINAL_ID: "6077001",
  API_KEY: "6YjWeCAyZGj.R8$GN7S&N0D%XZG879@PGOPR@HJZEO",
  IDENTITY_URL: "https://identity.uat.payroc.com/authorize",
  API_BASE_URL: "https://api.uat.payroc.com",
};

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) {
    console.log("✔ Using cached access token");
    return tokenCache.token;
  }

  console.log("🔄 Fetching new access token...");

  const authResponse = await fetch(PAYROC_CONFIG.IDENTITY_URL, {
    method: "POST",
    headers: {
      "x-api-key": PAYROC_CONFIG.API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!authResponse.ok) {
    const errorText = await authResponse.text();
    throw new Error(`Authentication failed: ${errorText}`);
  }

  const authData = await authResponse.json();
  const accessToken = authData.access_token || authData.accessToken;
  const expiresIn = authData.expires_in || 3600;

  tokenCache = {
    token: accessToken,
    expiresAt: Date.now() + (expiresIn - 60) * 1000,
  };

  console.log("✔ Access token cached");
  return accessToken;
}

// ------------------------------------------------------
// GET — Fetch payments by Merchant Reference
// ------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantReference = searchParams.get("merchantReference");
    const orderId = searchParams.get("orderId");

    if (!merchantReference && !orderId) {
      return NextResponse.json(
        { error: "Missing required query parameter: merchantReference or orderId" },
        { status: 400 }
      );
    }

    console.log("\n📌 Searching for:", { merchantReference, orderId });

    const accessToken = await getAccessToken();

    // If searching by merchant reference
    if (merchantReference) {
      console.log("🔍 Step 1: Fetching payment links...");

      const paymentLinksUrl = new URL(
        `${PAYROC_CONFIG.API_BASE_URL}/v1/processing-terminals/${PAYROC_CONFIG.TERMINAL_ID}/payment-links`
      );
      paymentLinksUrl.searchParams.append("limit", "100");

      const linksResponse = await fetch(paymentLinksUrl.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": PAYROC_CONFIG.API_KEY,
        },
      });

      if (!linksResponse.ok) {
        const errorText = await linksResponse.text();
        return NextResponse.json(
          { error: "Failed to fetch payment links", details: errorText },
          { status: linksResponse.status }
        );
      }

      const linksData = await linksResponse.json();
      console.log("✔ Fetched", linksData.data?.length || 0, "payment links");

      // Find payment link with matching merchant reference
      const matchingLink = linksData.data?.find((link: any) => 
        link.merchantReference === merchantReference
      );

      if (!matchingLink) {
        return NextResponse.json({
          success: false,
          error: "No payment link found with this merchant reference",
          merchantReference,
        }, { status: 404 });
      }

      console.log("✔ Found payment link:", matchingLink.paymentLinkId);

      // Step 2: Try to retrieve the payment link details (may include payments)
      console.log("\n🔍 Step 2: Retrieving payment link details...");
      
      const retrieveLinkUrl = `${PAYROC_CONFIG.API_BASE_URL}/v1/processing-terminals/${PAYROC_CONFIG.TERMINAL_ID}/payment-links/${matchingLink.paymentLinkId}`;
      
      console.log("🔗 Retrieve Link URL:", retrieveLinkUrl);

      const retrieveResponse = await fetch(retrieveLinkUrl, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": PAYROC_CONFIG.API_KEY,
        },
      });

      if (retrieveResponse.ok) {
        const linkDetails = await retrieveResponse.json();
        console.log("✔ Retrieved payment link details");
        console.log("📄 Link Details:", JSON.stringify(linkDetails, null, 2));
        
        // Check if payments are included in the response
        if (linkDetails.payments || linkDetails.transactions) {
          return NextResponse.json({
            success: true,
            merchantReference,
            paymentLink: linkDetails,
            transactions: linkDetails.payments || linkDetails.transactions || [],
          });
        }
      }

      // Step 3: If retrieve doesn't include payments, get them separately
      console.log("\n🔍 Step 3: Fetching all payments and filtering...");

      const paymentsUrl = new URL(`${PAYROC_CONFIG.API_BASE_URL}/v1/payments`);
      paymentsUrl.searchParams.append("processingTerminalId", PAYROC_CONFIG.TERMINAL_ID);
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      
      paymentsUrl.searchParams.append("startDate", startDate.toISOString());
      paymentsUrl.searchParams.append("endDate", endDate.toISOString());
      paymentsUrl.searchParams.append("limit", "100");

      const paymentsResponse = await fetch(paymentsUrl.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": PAYROC_CONFIG.API_KEY,
        },
      });

      if (!paymentsResponse.ok) {
        const errorText = await paymentsResponse.text();
        return NextResponse.json(
          { error: "Failed to fetch payments", details: errorText },
          { status: paymentsResponse.status }
        );
      }

      const paymentsData = await paymentsResponse.json();
      console.log("✔ Fetched", paymentsData.data?.length || 0, "total payments");

      // Return ALL payment link transactions (starting with "PL_")
      // Since we can't directly link payments to a specific payment link
      const linkPayments = paymentsData.data?.filter((payment: any) => {
        return payment.order?.orderId?.startsWith("PL_");
      }) || [];

      console.log("✔ Found", linkPayments.length, "payment link transaction(s)");

      return NextResponse.json({
        success: true,
        merchantReference,
        paymentLink: {
          paymentLinkId: matchingLink.paymentLinkId,
          merchantReference: matchingLink.merchantReference,
          status: matchingLink.status,
          paymentUrl: matchingLink.assets?.paymentUrl,
        },
        note: "Showing all Payment Link transactions from the last 30 days. Payroc API doesn't provide a direct way to link payments to specific payment links.",
        count: linkPayments.length,
        transactions: linkPayments,
      });
    }

    // If searching by orderId (direct approach)
    if (orderId) {
      const paymentsUrl = new URL(`${PAYROC_CONFIG.API_BASE_URL}/v1/payments`);
      paymentsUrl.searchParams.append("processingTerminalId", PAYROC_CONFIG.TERMINAL_ID);
      
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      
      paymentsUrl.searchParams.append("startDate", startDate.toISOString());
      paymentsUrl.searchParams.append("endDate", endDate.toISOString());
      paymentsUrl.searchParams.append("limit", "100");

      const response = await fetch(paymentsUrl.toString(), {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "x-api-key": PAYROC_CONFIG.API_KEY,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return NextResponse.json(
          { error: "Failed to fetch payments", details: errorText },
          { status: response.status }
        );
      }

      const data = await response.json();
      const filteredPayments = data.data?.filter((payment: any) => 
        payment.order?.orderId === orderId
      ) || [];

      return NextResponse.json({
        success: true,
        orderId,
        count: filteredPayments.length,
        transactions: filteredPayments,
      });
    }

  } catch (error) {
    console.error("❌ Unexpected error:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
