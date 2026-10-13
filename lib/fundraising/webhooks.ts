/**
 * Self-serve outbound webhooks for the fundraising platform (Phase 2).
 *
 * A tenant registers a URL (typically a GHL inbound-webhook trigger). When a
 * fundraising donation completes, we POST the donation payload to every active
 * matching webhook, so they can drive GHL automations without support.
 */
import { db } from "@/lib/db";
import { fundraisingWebhook, fundraisingCampaign, type NewFundraisingWebhook } from "@/lib/db/schema-fundraising";
import { contact } from "@/lib/db/schema";
import { and, eq, isNull, or, desc } from "drizzle-orm";

export async function listWebhooks(locationId: string) {
  return db
    .select()
    .from(fundraisingWebhook)
    .where(eq(fundraisingWebhook.locationId, locationId))
    .orderBy(desc(fundraisingWebhook.createdAt));
}

export async function createWebhook(values: NewFundraisingWebhook) {
  const [row] = await db.insert(fundraisingWebhook).values(values).returning();
  return row;
}

export async function deleteWebhook(locationId: string, id: number) {
  const [row] = await db
    .delete(fundraisingWebhook)
    .where(and(eq(fundraisingWebhook.locationId, locationId), eq(fundraisingWebhook.id, id)))
    .returning({ id: fundraisingWebhook.id });
  return row ?? null;
}

/**
 * Fire all active webhooks for a completed donation. Matches webhooks scoped to
 * the campaign (or campaign_id NULL = all campaigns). Best-effort + non-blocking:
 * failures are recorded (last_status) but never break the payment flow.
 */
export async function fireDonationWebhooks(
  locationId: string,
  campaignId: number | null,
  payload: Record<string, unknown>,
): Promise<void> {
  let hooks;
  try {
    hooks = await db
      .select()
      .from(fundraisingWebhook)
      .where(
        and(
          eq(fundraisingWebhook.locationId, locationId),
          eq(fundraisingWebhook.isActive, true),
          campaignId != null
            ? or(isNull(fundraisingWebhook.campaignId), eq(fundraisingWebhook.campaignId, campaignId))
            : isNull(fundraisingWebhook.campaignId),
        ),
      );
  } catch (err) {
    console.error("[fundraising.webhooks] lookup failed:", err instanceof Error ? err.message : err);
    return;
  }

  await Promise.all(
    hooks.map(async (h) => {
      let status = 0;
      try {
        const res = await fetch(h.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event: h.event, ...payload }),
        });
        status = res.status;
      } catch (err) {
        console.error(`[fundraising.webhooks] POST ${h.url} failed:`, err instanceof Error ? err.message : err);
      }
      try {
        await db
          .update(fundraisingWebhook)
          .set({ lastFiredAt: new Date(), lastStatus: status, updatedAt: new Date() })
          .where(eq(fundraisingWebhook.id, h.id));
      } catch {
        /* stamping is best-effort */
      }
    }),
  );
}

/**
 * Post-donation hook for a completed Crowded donation that belongs to a
 * fundraising campaign: (1) apply the campaign's GHL tag to the donor's GHL
 * contact, and (2) fire the tenant's self-serve webhooks. Best-effort —
 * never throws into the payment flow.
 */
export async function handleFundraisingDonation(opts: {
  locationId: string;
  crowdedFormId: number;
  contactId: number;
  amountUsd: string;
  referenceNumber: string;
  status: string;
  donorEmail?: string | null;
}): Promise<void> {
  let camp;
  try {
    [camp] = await db
      .select({
        id: fundraisingCampaign.id,
        ghlTag: fundraisingCampaign.ghlTag,
        campaignId: fundraisingCampaign.campaignId,
      })
      .from(fundraisingCampaign)
      .where(
        and(
          eq(fundraisingCampaign.locationId, opts.locationId),
          eq(fundraisingCampaign.crowdedFormId, opts.crowdedFormId),
        ),
      )
      .limit(1);
  } catch (err) {
    console.error("[fundraising.donation] campaign lookup failed:", err instanceof Error ? err.message : err);
    return;
  }
  if (!camp) return; // this Crowded form isn't part of a fundraising campaign

  // 1. Mirror the campaign tag onto the donor's GHL contact.
  if (camp.ghlTag) {
    try {
      const [c] = await db
        .select({ ghlContactId: contact.ghlContactId })
        .from(contact)
        .where(eq(contact.id, opts.contactId))
        .limit(1);
      if (c?.ghlContactId) {
        const { pushContactTagAdd } = await import("@/lib/ghl/push-contact");
        await pushContactTagAdd(opts.contactId, opts.locationId, c.ghlContactId, camp.ghlTag);
      }
    } catch (err) {
      console.error("[fundraising.donation] GHL tag apply failed:", err instanceof Error ? err.message : err);
    }
  }

  // 2. Fire self-serve webhooks scoped to this campaign (or all-campaign hooks).
  await fireDonationWebhooks(opts.locationId, camp.id, {
    campaignId: camp.id,
    donationReference: opts.referenceNumber,
    amountUsd: opts.amountUsd,
    status: opts.status,
    contactId: opts.contactId,
    donorEmail: opts.donorEmail ?? null,
  });
}
