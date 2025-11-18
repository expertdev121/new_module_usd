import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

// Payroc Hosted Fields Configuration (Sandbox)
const PAYROC_CONFIG = {
  MERCHANT_ID: '6077',
  TERMINAL_ID: '6077001',
  API_KEY: '6YjWeCAyZGj.R8$GN7S&N0D%XZG879@PGOPR@HJZEO',
  IDENTITY_URL: 'https://identity.uat.payroc.com/authorize',
  API_BASE_URL: 'https://api.uat.payroc.com',
  LIB_VERSION: '1.6.0.172429',
  HOSTED_FIELDS_SCRIPT: "https://cdn.uat.payroc.com/js/hosted-fields/hosted-fields-1.6.0.172429.js"

};

// Create Hosted Fields Session
export async function POST(request: NextRequest) {
  try {
    // First get bearer token
    const tokenResponse = await fetch(PAYROC_CONFIG.IDENTITY_URL, {
      method: 'POST',
      headers: {
        'x-api-key': PAYROC_CONFIG.API_KEY,
        'Accept': 'application/json',
        'User-Agent': 'Givesuite/1.0',
      },
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Payroc Identity Service error:', errorText);
      return NextResponse.json(
        { error: 'Failed to get bearer token for session' },
        { status: tokenResponse.status }
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Create hosted fields session
    const sessionResponse = await fetch(
      `${PAYROC_CONFIG.API_BASE_URL}/v1/processing-terminals/${PAYROC_CONFIG.TERMINAL_ID}/hosted-fields-sessions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Givesuite/1.0',     
          'Accept': 'application/json',
          'Idempotency-Key': randomUUID(),
        },
        body: JSON.stringify({
          libVersion: PAYROC_CONFIG.LIB_VERSION,
          scenario: 'payment',
        }),
      }
    );

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();
      console.error('Payroc Hosted Fields Session error:', errorText);
      return NextResponse.json(
        { error: 'Failed to create hosted fields session' },
        { status: sessionResponse.status }
      );
    }

    const sessionData = await sessionResponse.json();
    return NextResponse.json({
      sessionToken: sessionData.token,
      expiresAt: sessionData.expiresAt,
    });
  } catch (error) {
    console.error('Error creating hosted fields session:', error);
    return NextResponse.json(
      { error: 'Failed to create hosted fields session' },
      { status: 500 }
    );
  }
}
