import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contact, manualDonation } from "@/lib/db/schema";

export const PUBLIC_STRIPE_LOCATION_ID = "NikJ6tAcHSe8UCLgYMqM";
const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

export type PublicStripeStatus = "succeeded" | "processing" | "failed";

export type StripePaymentIntentEventObject = {
  id: string;
  amount?: number;
  amount_received?: number;
  created?: number;
  status?: string;
  receipt_email?: string | null;
  payment_method?: string | { id?: string } | null;
  customer?: string | null;
  metadata?: Record<string, string>;
  last_payment_error?: {
    message?: string | null;
  } | null;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function splitName(fullName: string) {
  const trimmed = fullName.trim();
  if (!trimmed) {
    return { firstName: "Donor", lastName: "" };
  }

  const parts = trimmed.split(/\s+/);
  return {
    firstName: parts[0] || "Donor",
    lastName: parts.slice(1).join(" "),
  };
}

export function parseAmountToCents(amount: string | number) {
  const numericAmount =
    typeof amount === "number" ? amount : Number.parseFloat(String(amount).trim());

  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    return null;
  }

  return Math.round(numericAmount * 100);
}

export function formatUsdAmountFromCents(amountInCents: number) {
  return (amountInCents / 100).toFixed(2);
}

export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string, secret: string) {
  const parts = signatureHeader.split(",").map((part) => part.trim());
  const timestampPart = parts.find((part) => part.startsWith("t="));
  const signatureParts = parts.filter((part) => part.startsWith("v1="));

  if (!timestampPart || signatureParts.length === 0) {
    throw new Error("Invalid Stripe signature header");
  }

  const timestamp = Number.parseInt(timestampPart.replace("t=", ""), 10);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Invalid Stripe signature timestamp");
  }

  const nowInSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowInSeconds - timestamp) > STRIPE_WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("Stripe signature timestamp is outside the tolerance window");
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac("sha256", secret)
    .update(signedPayload, "utf8")
    .digest("hex");

  const expectedBuffer = Buffer.from(expectedSignature, "hex");
  const matched = signatureParts.some((part) => {
    const candidate = part.replace("v1=", "");
    try {
      const candidateBuffer = Buffer.from(candidate, "hex");
      return (
        candidateBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(candidateBuffer, expectedBuffer)
      );
    } catch {
      return false;
    }
  });

  if (!matched) {
    throw new Error("Stripe signature verification failed");
  }
}

export async function stripeApiRequest(
  path: string,
  init: {
    method?: string;
    body?: URLSearchParams;
  } = {}
) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }

  const response = await fetch(`${STRIPE_API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(init.body
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    body: init.body?.toString(),
  });

  const payload = await response.json();

  if (!response.ok) {
    const message =
      payload?.error?.message ||
      `Stripe API request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

export async function getStripePaymentMethodType(paymentMethodId?: string | null) {
  if (!paymentMethodId) {
    return "unknown";
  }

  const paymentMethod = await stripeApiRequest(`/payment_methods/${paymentMethodId}`);
  const type = String(paymentMethod?.type || "");

  if (type === "us_bank_account") {
    return "ach";
  }

  if (type === "card") {
    return "card";
  }

  return type || "unknown";
}

export async function sendToGhlWebhook(payload: {
  name: string;
  email: string;
  amount: string;
  payment_status: PublicStripeStatus;
  payment_method: string;
  stripe_payment_intent_id: string;
}) {
  const webhookUrl = process.env.GHL_WEBHOOK_URL;
  if (!webhookUrl) {
    throw new Error("Missing GHL_WEBHOOK_URL");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`GHL webhook request failed with status ${response.status}`);
  }
}

export async function createManualDonationForPublicStripePayment(params: {
  paymentIntentId: string;
  name: string;
  email: string;
  amountInCents: number;
  paymentMethod: string;
  locationId: string;
  paymentStatus: "pending" | "completed" | "failed";
  paidAtUnix?: number;
}) {
  const email = normalizeEmail(params.email);
  const { firstName, lastName } = splitName(params.name);
  const paymentDate = params.paidAtUnix
    ? new Date(params.paidAtUnix * 1000).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  const existingDonation = await db
    .select({
      id: manualDonation.id,
      paymentStatus: manualDonation.paymentStatus,
    })
    .from(manualDonation)
    .innerJoin(contact, eq(manualDonation.contactId, contact.id))
    .where(
      and(
        eq(contact.locationId, params.locationId),
        eq(manualDonation.referenceNumber, params.paymentIntentId)
      )
    )
    .limit(1);

  if (existingDonation.length > 0) {
    const [updatedDonation] = await db
      .update(manualDonation)
      .set({
        amount: formatUsdAmountFromCents(params.amountInCents),
        amountUsd: formatUsdAmountFromCents(params.amountInCents),
        paymentDate,
        receivedDate: paymentDate,
        paymentMethod: params.paymentMethod,
        paymentStatus: params.paymentStatus,
        notes: `Public Stripe payment ${params.paymentStatus} for location ${params.locationId}.`,
        updatedAt: new Date(),
      })
      .where(eq(manualDonation.id, existingDonation[0].id))
      .returning({ id: manualDonation.id });

    return {
      donationId: updatedDonation.id,
      created: false,
      updated: true,
    };
  }

  const existingContact = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
    })
    .from(contact)
    .where(and(eq(contact.locationId, params.locationId), eq(contact.email, email)))
    .limit(1);

  let contactId = existingContact[0]?.id;

  if (!contactId) {
    const [newContact] = await db
      .insert(contact)
      .values({
        firstName,
        lastName,
        displayName: params.name.trim() || `${firstName} ${lastName}`.trim(),
        email,
        locationId: params.locationId,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning({ id: contact.id });

    contactId = newContact.id;
  }

  const [newDonation] = await db
    .insert(manualDonation)
    .values({
      contactId,
      amount: formatUsdAmountFromCents(params.amountInCents),
      currency: "USD",
      amountUsd: formatUsdAmountFromCents(params.amountInCents),
      exchangeRate: "1.0000",
      paymentDate,
      receivedDate: paymentDate,
      paymentMethod: params.paymentMethod,
      paymentStatus: params.paymentStatus,
      referenceNumber: params.paymentIntentId,
      receiptIssued: false,
      notes: `Public Stripe payment ${params.paymentStatus} for location ${params.locationId}.`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: manualDonation.id });

  return {
    donationId: newDonation.id,
    created: true,
    updated: false,
  };
}
