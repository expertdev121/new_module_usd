/**
 * Backfill manual_donation.campaign_id for GHL-pulled payments from the GHL
 * product description ("Building Fund Donation - $360 One-Time ($360)" ->
 * "Building Fund Donation - $360 One-Time"). Only rows with campaign_id NULL
 * are touched. Generic form payments (description "Payment") are skipped.
 *
 * Dry run by default; pass --apply to write.
 *   npx tsx --env-file=.env scripts/backfill-ghl-campaigns.ts <locationId> [--apply]
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { manualDonation } from "@/lib/db/schema";
import { listTransactionsFromGhl } from "@/lib/ghl/api-client";
import { resolveCampaignId } from "@/lib/api-keys/ingest";

const locationId = process.argv[2];
const apply = process.argv.includes("--apply");
if (!locationId) {
  console.error("usage: backfill-ghl-campaigns.ts <locationId> [--apply]");
  process.exit(1);
}

function campaignFromDescription(desc: unknown): string | null {
  if (typeof desc !== "string") return null;
  const name = desc.replace(/\s*\(\$[\d,.]+\)\s*$/, "").trim();
  if (!name || name.toLowerCase() === "payment") return null;
  return name;
}

async function main() {
  const rows = await db
    .select({ id: manualDonation.id, ghlId: manualDonation.ghlResourceId })
    .from(manualDonation)
    .where(
      and(
        eq(manualDonation.locationId, locationId),
        eq(manualDonation.ghlSource, "ghl_transaction"),
        isNull(manualDonation.campaignId),
      ),
    );
  console.log(`${rows.length} GHL transaction rows without a campaign`);

  const names = new Map<string, string | null>();
  let cursor: string | null = null;
  do {
    const page = await listTransactionsFromGhl(locationId, { limit: 100, cursor });
    for (const r of page.records) {
      const raw = r.raw as any;
      names.set(
        r.id,
        campaignFromDescription(raw.chargeSnapshot?.description ?? raw.subscriptionSnapshot?.description ?? r.description),
      );
    }
    cursor = page.nextCursor;
  } while (cursor);

  const plan = rows.map((r) => ({ ...r, name: r.ghlId ? names.get(r.ghlId) ?? null : null }));
  const counts = new Map<string, number>();
  let skipped = 0;
  for (const p of plan) {
    if (!p.name) skipped++;
    else counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  }
  console.table([...counts].map(([campaign, rows]) => ({ campaign, rows })));
  console.log(`would update ${plan.length - skipped}, skip ${skipped} (no usable product name)`);

  if (!apply) return console.log("dry run — re-run with --apply to write");

  for (const p of plan) {
    if (!p.name) continue;
    const campaignId = await resolveCampaignId(locationId, p.name);
    if (campaignId == null) continue;
    await db
      .update(manualDonation)
      .set({ campaignId })
      .where(and(eq(manualDonation.id, p.id), isNull(manualDonation.campaignId)));
  }
  console.log("done");
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
