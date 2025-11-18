import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";

// Payroc Hosted Fields Configuration (Sandbox)
const PAYROC_CONFIG = {
  MERCHANT_ID: '6077',
  TERMINAL_ID: '6077001',
  API_KEY: '6YjWeCAyZGj.R8$GN7S&N0D%XZG879@PGOPR@HJZEO',
  IDENTITY_URL: 'https://identity.uat.payroc.com/authorize',
  API_BASE_URL: 'https://api.uat.payroc.com',
  HOSTED_FIELDS_SCRIPT: 'https://cdn.uat.payroc.com/js/hosted-fields/hosted-fields-1.6.0.172441.js',
  LIB_VERSION: '1.6.0-beta.172441',
};

// Get Payroc configuration for frontend
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const action = url.searchParams.get('action');

    if (action === 'bearer-token') {
      // Get Bearer Token from Payroc Identity Service
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
    } else if (action === 'hosted-fields-session') {
      // Create Hosted Fields Session
      try {
        // First get bearer token
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
    } else {
      // Return configuration
      return NextResponse.json({
        config: {
          merchantId: PAYROC_CONFIG.MERCHANT_ID,
          terminalId: PAYROC_CONFIG.TERMINAL_ID,
          apiKey: PAYROC_CONFIG.API_KEY,
          identityUrl: PAYROC_CONFIG.IDENTITY_URL,
          apiBaseUrl: PAYROC_CONFIG.API_BASE_URL,
          hostedFieldsScript: PAYROC_CONFIG.HOSTED_FIELDS_SCRIPT,
          libVersion: PAYROC_CONFIG.LIB_VERSION,
        }
      });
    }
  } catch (error) {
    console.error('Error in Payroc API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Process Payroc payment
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { token, amount, currency, paymentData } = body;

    // Validate required fields
    if (!token || !amount || !currency) {
      return NextResponse.json(
        { error: 'Missing required fields: token, amount, currency' },
        { status: 400 }
      );
    }

    // Here you would integrate with Payroc's API to process the payment
    // This is a placeholder for the actual Payroc API integration

    // Example API call structure (you would replace this with actual Payroc API calls)
    const payrocResponse = await fetch(`${PAYROC_CONFIG.API_BASE_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAYROC_CONFIG.API_KEY}`,
        'X-Merchant-ID': PAYROC_CONFIG.MERCHANT_ID,
        'X-Terminal-ID': PAYROC_CONFIG.TERMINAL_ID,
      },
      body: JSON.stringify({
        token,
        amount,
        currency,
        ...paymentData
      }),
    });

    if (!payrocResponse.ok) {
      const errorData = await payrocResponse.json();
      return NextResponse.json(
        { error: 'Payment processing failed', details: errorData },
        { status: payrocResponse.status }
      );
    }

    const paymentResult = await payrocResponse.json();

    return NextResponse.json({
      success: true,
      paymentId: paymentResult.id,
      status: paymentResult.status,
      transactionId: paymentResult.transactionId,
      amount: paymentResult.amount,
      currency: paymentResult.currency,
    });

  } catch (error) {
    console.error('Error processing Payroc payment:', error);
    return NextResponse.json(
      { error: 'Payment processing failed' },
      { status: 500 }
    );
  }
}
