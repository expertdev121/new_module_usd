import { NextRequest, NextResponse } from "next/server";

// Payroc Hosted Fields Configuration (Sandbox)
const PAYROC_CONFIG = {
  MERCHANT_ID: '6077',
  TERMINAL_ID: '6077001',
  API_KEY: '6YjWeCAyZGj.R8$GN7S&N0D%XZG879@PGOPR@HJZEO',
  IDENTITY_URL: 'https://identity.uat.payroc.com/authorize',
  API_BASE_URL: 'https://api.uat.payroc.com',
  HOSTED_FIELDS_SCRIPT: 'https://cdn.uat.payroc.com/js/hosted-fields/hosted-fields-1.6.0.172429.js',
  LIB_VERSION: '1.6.0-beta.172441',
};

// Get Bearer Token from Payroc Identity Service
export async function POST(request: NextRequest) {
  try {
    const tokenResponse = await fetch(PAYROC_CONFIG.IDENTITY_URL, {
      method: 'POST',
      headers: {
        'x-api-key': PAYROC_CONFIG.API_KEY,
        'Content-Type': 'application/json',
      },
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Payroc Identity Service error:', errorText);
      return NextResponse.json(
        { error: 'Failed to get bearer token from Payroc' },
        { status: tokenResponse.status }
      );
    }

    const tokenData = await tokenResponse.json();
    return NextResponse.json({
      access_token: tokenData.access_token,
      token_type: tokenData.token_type,
      expires_in: tokenData.expires_in,
    });
  } catch (error) {
    console.error('Error getting bearer token:', error);
    return NextResponse.json(
      { error: 'Failed to get bearer token' },
      { status: 500 }
    );
  }
}
