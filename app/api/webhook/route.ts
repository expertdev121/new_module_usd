import { NextRequest, NextResponse } from "next/server";
// In a real Next.js app, you'd import db and schema here:
// import { db } from "@/lib/db";
// import { payrocWebhookEvent } from "@/lib/db/schema";
// import { eq } from "drizzle-orm";

import * as crypto from 'crypto';

// !!! IMPORTANT: USE THE EXACT SAME SECRET USED in create-subscription.ts
const PAYROC_WEBHOOK_SECRET = "sec_W3bH00kT0K3n_A1ph4NuM3r1c_S3cr3t_789XYZ";

/**
 * Standard function to verify the webhook signature (HMAC-SHA256).
 * NOTE: The exact header name (e.g., 'Payroc-Signature') and algorithm (e.g., 'sha256')
 * must be confirmed with Payroc documentation, but this implements the most common pattern.
 *
 * @param {string} signatureHeaderValue The signature received from Payroc in the request header.
 * @param {string} payload The raw, stringified JSON body of the request.
 * @param {string} secret The webhook secret known to your app and Payroc.
 * @returns {boolean} True if the signature is valid.
 */
function verifySignature(signatureHeaderValue: string | null, payload: string, secret: string): boolean {
    if (!signatureHeaderValue) {
        console.error("❌ Signature header missing.");
        return false;
    }

    // Payroc likely uses a structure like 't=<timestamp>,v1=<signature>'
    // For simplicity, we assume the header is just the signature hash.
    // If Payroc uses 'v1=<hash>', you need to parse it out.
    // E.g., const hash = signatureHeaderValue.split(',').find(s => s.startsWith('v1=')).substring(3);

    try {
        const hmac = crypto.createHmac('sha256', secret);
        // Compute the hash from the raw payload body
        const computedSignature = hmac.update(payload).digest('hex');

        // Compare the computed signature against the one sent by Payroc
        // We use timing-safe comparison to prevent timing attacks
        return crypto.timingSafeEqual(Buffer.from(computedSignature), Buffer.from(signatureHeaderValue));

    } catch (e) {
        console.error("❌ Error during signature verification:", e);
        return false;
    }
}

export async function POST(request: NextRequest) {
    // 1. Get the raw request body and the signature header
    const rawBody = await request.text();
    let payload;

    try {
        payload = JSON.parse(rawBody);
    } catch (e) {
        console.error("❌ Failed to parse JSON body.");
        return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    // !! 2. SECURITY CHECK: Signature Verification
    // The actual header name must be confirmed with Payroc (e.g., 'Payroc-Signature')
    const signatureHeader = request.headers.get('Payroc-Signature'); // <-- **Check Payroc Docs for the correct header name**

    if (!verifySignature(signatureHeader, rawBody, PAYROC_WEBHOOK_SECRET)) {
        console.warn("⚠️ Webhook received with invalid signature. Ignoring.");
        return NextResponse.json({ error: "Signature verification failed" }, { status: 403 });
    }

    // Signature Verified! We can trust the source.
    const { id: eventId, type: eventType, data } = payload;

    if (!eventId || !eventType) {
        console.error("❌ Invalid CloudEvents payload: missing id or type");
        return NextResponse.json({ error: "Invalid payload structure" }, { status: 400 });
    }

    console.log(`✅ Received & verified Payroc event: ${eventType} (${eventId})`);

    // 3. Idempotency and Event Processing
    // In a real application, you would check your database for the eventId
    // to prevent reprocessing the same event if Payroc retries the notification.

    // 4. Handle the specific event type
    if (eventType === "payment.succeeded") {
        console.log(`💲 Successful Payment Event Data:`, data);
        
        // !!! CRUCIAL STEP:
        // Use the data object (which contains the transaction details)
        // to update your local database, mark the order as paid, and fulfill the order.
        
        // Example structure of data (MUST be confirmed by Payroc documentation):
        // const { transactionId, amount, currency, metadata } = data;
        
        // await db.updatePaymentStatus(transactionId, 'SUCCESS', amount);
        
        console.log("✔ Payment processed and database updated (simulated).");

    } else {
        console.log(`ℹ️ Received non-critical event type: ${eventType}. Ignoring.`);
    }

    // 5. Acknowledge Receipt (Mandatory for Payroc to stop retrying)
    // Payroc requires a 200 response code.
    return NextResponse.json({ message: "Webhook received and processed" }, { status: 200 });
}