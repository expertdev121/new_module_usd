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
// GET — Fetch payments with terminal ID and date range
// ------------------------------------------------------
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const merchantReference = searchParams.get("merchantReference");
    const orderId = searchParams.get("orderId");
    const daysBack = parseInt(searchParams.get("daysBack") || "7");

    const searchTerm = merchantReference || orderId;

    if (!searchTerm) {
      return NextResponse.json(
        { error: "Missing required query parameter: merchantReference or orderId" },
        { status: 400 }
      );
    }

    console.log("\n📌 Searching for:", searchTerm);
    console.log("📅 Date range: Last", daysBack, "days");

    // 1️⃣ GET ACCESS TOKEN
    const accessToken = await getAccessToken();

    // 2️⃣ FETCH PAYMENTS WITH TERMINAL ID + DATE RANGE
    const url = new URL(`${PAYROC_CONFIG.API_BASE_URL}/v1/payments`);
    
    // Add processingTerminalId to narrow the search
    url.searchParams.append("processingTerminalId", PAYROC_CONFIG.TERMINAL_ID);
    
    // Add date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - daysBack);
    
    url.searchParams.append("startDate", startDate.toISOString());
    url.searchParams.append("endDate", endDate.toISOString());
    url.searchParams.append("limit", "100");

    console.log("🔗 Request URL:", url.toString());

    const response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "x-api-key": PAYROC_CONFIG.API_KEY,
      },
    });

    console.log("📡 Response Status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("❌ Error Response:", errorText);

      let errorDetails;
      try {
        errorDetails = JSON.parse(errorText);
      } catch {
        errorDetails = errorText;
      }

      return NextResponse.json(
        {
          error: "Failed to fetch payments",
          details: errorDetails,
          statusCode: response.status,
        },
        { status: response.status }
      );
    }

    const data = await response.json();
    console.log("✔ Fetched", data.data?.length || 0, "total payments");

    // Log structure of first payment
    if (data.data && data.data.length > 0) {
      console.log("\n📄 Sample payment structure:");
      console.log(JSON.stringify(data.data[0], null, 2));
    }

    // Filter payments by searching through all fields
    const filteredPayments = data.data?.filter((payment: any) => {
      const paymentString = JSON.stringify(payment).toLowerCase();
      const searchString = searchTerm.toLowerCase();
      
      return paymentString.includes(searchString);
    }) || [];

    console.log("✔ Found", filteredPayments.length, "matching payment(s)");

    if (filteredPayments.length > 0) {
      console.log("\n📄 Matching transaction:");
      console.log(JSON.stringify(filteredPayments[0], null, 2));
    }

    return NextResponse.json({
      success: true,
      searchTerm,
      processingTerminalId: PAYROC_CONFIG.TERMINAL_ID,
      dateRange: {
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      },
      totalPayments: data.data?.length || 0,
      matchingPayments: filteredPayments.length,
      transactions: filteredPayments,
      pagination: data.pagination || null,
    });
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
