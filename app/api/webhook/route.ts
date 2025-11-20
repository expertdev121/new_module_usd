import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { payrocWebhookEvent, payrocPayment } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

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
    // Check if this event has already been processed
    const existingEvent = await db.select().from(payrocWebhookEvent).where(eq(payrocWebhookEvent.eventId, eventId)).limit(1);

    if (existingEvent.length > 0) {
        console.log(`⚠️ Event ${eventId} already processed. Skipping.`);
        return NextResponse.json({ message: "Event already processed" }, { status: 200 });
    }

    // Store the webhook event
    await db.insert(payrocWebhookEvent).values({
        eventId,
        eventType,
        data,
        processed: false,
        signatureVerified: true,
        idempotencyChecked: true,
    });

    // 4. Handle the specific event type
    if (eventType === "payment.succeeded") {
        console.log(`💲 Successful Payment Event Data:`, data);

        // Extract payment data from the webhook
        const transaction = data; // Assuming data contains the transaction details

        // Check if payment already exists
        const existingPayment = await db.select().from(payrocPayment).where(eq(payrocPayment.paymentId, transaction.paymentId)).limit(1);

        const paymentData = {
            paymentId: transaction.paymentId,
            orderId: transaction.order?.orderId || '',
            merchantReference: transaction.merchantReference || null,
            processingTerminalId: transaction.processingTerminalId,
            amount: transaction.order?.amount || 0,
            currency: transaction.order?.currency || 'USD',
            status: transaction.transactionResult?.status || 'complete',
            transactionType: transaction.transactionResult?.type || 'sale',
            customerEmail: transaction.customer?.contactMethods?.find((m: any) => m.type === 'email')?.value || null,
            customerName: transaction.customer?.billingAddress ? `${transaction.customer.billingAddress.address1 || ''} ${transaction.customer.billingAddress.address2 || ''}`.trim() : null,
            cardType: transaction.card?.type || null,
            cardLastFour: transaction.card?.cardNumber?.slice(-4) || null,
            cardExpiry: transaction.card?.expiryDate || null,
            approvalCode: transaction.transactionResult?.approvalCode || null,
            responseCode: transaction.transactionResult?.responseCode || null,
            responseMessage: transaction.transactionResult?.responseMessage || null,
            transactionDate: new Date(transaction.order?.dateTime || Date.now()),
            rawData: transaction,
        };

        if (existingPayment.length > 0) {
            // Update existing payment
            await db.update(payrocPayment).set({
                ...paymentData,
                updatedAt: new Date(),
            }).where(eq(payrocPayment.paymentId, transaction.paymentId));
            console.log(`✔ Updated payment ${transaction.paymentId}`);
        } else {
            // Insert new payment
            await db.insert(payrocPayment).values(paymentData);
            console.log(`✔ Inserted new payment ${transaction.paymentId}`);
        }

        // Mark the webhook event as processed
        await db.update(payrocWebhookEvent).set({
            processed: true,
        }).where(eq(payrocWebhookEvent.eventId, eventId));

        console.log("✔ Payment processed and database updated.");

    } else {
        console.log(`ℹ️ Received non-critical event type: ${eventType}. Ignoring.`);
    }

    // 5. Acknowledge Receipt (Mandatory for Payroc to stop retrying)
    // Payroc requires a 200 response code.
    return NextResponse.json({ message: "Webhook received and processed" }, { status: 200 });
}