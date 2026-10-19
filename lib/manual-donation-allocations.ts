/**
 * Shared helper for the manual-donation "Campaign Split" feature (GS-93/GS-94).
 *
 * The `manual_donation_allocation` table has a unique index on
 * (manual_donation_id, campaign_id), so inserting two split lines for the
 * same campaign would violate that constraint and surface as a hard error.
 * Per GS-94 test 6, picking the same campaign twice should instead merge the
 * lines (sum their amounts) — this is used by both the POST (create) and PUT
 * (update) manual-donation routes before validating/inserting allocation rows.
 */
export function mergeAllocationsByCampaign<T extends { campaignId: number; amount: number }>(
  allocations: T[]
): { campaignId: number; amount: number }[] {
  const totals = new Map<number, number>();
  const order: number[] = [];
  for (const a of allocations) {
    if (!totals.has(a.campaignId)) {
      order.push(a.campaignId);
      totals.set(a.campaignId, 0);
    }
    totals.set(a.campaignId, totals.get(a.campaignId)! + a.amount);
  }
  return order.map((campaignId) => ({ campaignId, amount: totals.get(campaignId)! }));
}
