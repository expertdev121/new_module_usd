/**
 * Writes a manual_donation row for a completed fundraising-campaign Stripe
 * Checkout payment. Called only from the webhook handler
 * (app/api/webhook/stripe/fundraising/[locationId]) once Stripe confirms
 * payment — mirrors the dedup/contact-upsert pattern in
 * lib/public-stripe-payments.ts's createManualDonationForPublicStripePayment.
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { contact, manualDonation } from "@/lib/db/schema";
import { normalizeEmail, splitName, formatUsdAmountFromCents } from "@/lib/public-stripe-payments";

export async function createManualDonationForFundraisingCheckout(params: {
  paymentIntentId: string;
  fundraisingCampaignId: number;
  locationId: string;
  name: string;
  email: string;
  amountInCents: number;
  baseAmountInCents: number;
  coveredFees: boolean;
  paidAtUnix?: number;
}): Promise<{ donationId: number; created: boolean; skipped: boolean }> {
  const email = normalizeEmail(params.email);
  const { firstName, lastName } = splitName(params.name);
  const paymentDate = params.paidAtUnix
    ? new Date(params.paidAtUnix * 1000).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  // Primary dedup: same Checkout payment already recorded (webhook retry / replay).
  const existingByReference = await db
    .select({ id: manualDonation.id })
    .from(manualDonation)
    .innerJoin(contact, eq(manualDonation.contactId, contact.id))
    .where(and(eq(contact.locationId, params.locationId), eq(manualDonation.referenceNumber, params.paymentIntentId)))
    .limit(1);

  if (existingByReference.length > 0) {
    return { donationId: existingByReference[0].id, created: false, skipped: true };
  }

  // Secondary dedup: same donor + date + amount, in case of a duplicate
  // Checkout Session for the same gift with a different PaymentIntent id.
  const formattedAmount = formatUsdAmountFromCents(params.amountInCents);
  const existingByDateAmount = await db
    .select({ id: manualDonation.id })
    .from(manualDonation)
    .innerJoin(contact, eq(manualDonation.contactId, contact.id))
    .where(
      and(
        eq(contact.locationId, params.locationId),
        eq(contact.email, email),
        eq(manualDonation.paymentDate, paymentDate),
        eq(manualDonation.amount, formattedAmount),
        eq(manualDonation.fundraisingCampaignId, params.fundraisingCampaignId),
      ),
    )
    .limit(1);

  if (existingByDateAmount.length > 0) {
    return { donationId: existingByDateAmount[0].id, created: false, skipped: true };
  }

  const existingContact = await db
    .select({ id: contact.id })
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

  const feeNote = params.coveredFees
    ? ` Donor covered fees: charged $${formatUsdAmountFromCents(params.amountInCents)}, campaign net $${formatUsdAmountFromCents(params.baseAmountInCents)}.`
    : "";

  const [newDonation] = await db
    .insert(manualDonation)
    .values({
      contactId,
      fundraisingCampaignId: params.fundraisingCampaignId,
      amount: formatUsdAmountFromCents(params.amountInCents),
      currency: "USD",
      amountUsd: formatUsdAmountFromCents(params.amountInCents),
      exchangeRate: "1.0000",
      paymentDate,
      receivedDate: paymentDate,
      paymentMethod: "card",
      paymentStatus: "completed",
      referenceNumber: params.paymentIntentId,
      receiptIssued: false,
      importSource: "stripe_fundraising",
      notes: `Fundraising campaign Checkout donation.${feeNote}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning({ id: manualDonation.id });

  return { donationId: newDonation.id, created: true, skipped: false };
}
