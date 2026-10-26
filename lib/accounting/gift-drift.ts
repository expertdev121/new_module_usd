/**
 * Detects gifts that were changed AFTER their deposit was closed.
 *
 * Many existing code paths edit gifts (manual edit, campaign merge, contact merge, GHL/Crowded/Stripe
 * webhooks, refunds), so instead of touching them or putting a trigger on the live donations table, closing a
 * deposit stores a snapshot of each gift (deposit_transactions.snap_*), and this compares the gift to it at the
 * moments that matter: viewing a deposit, exporting it, posting it.
 *
 *  - Not yet sent (closed): sending is blocked until the deposit is reopened and closed again (or voided).
 *  - Already sent (exported / posted): it cannot be unsent, so it is flagged for an adjusting entry instead.
 */
import { sql } from "drizzle-orm";
import { intArray, rows } from "./sql-helpers";

export interface GiftDrift {
  depositId: number;
  giftId: number;
  donor: string;
  changes: string[];
}

const usd = (v: string | null) => (v == null ? "none" : `$${Number.parseFloat(v).toFixed(2)}`);

export async function driftFor(locationId: string, depositIds: number[]): Promise<Map<number, GiftDrift[]>> {
  const out = new Map<number, GiftDrift[]>();
  if (depositIds.length === 0) return out;
  const list = await rows(sql`
    select dt.deposit_id, md.id as gift_id, ct.first_name, ct.last_name,
           md.amount::text as amount, dt.snap_amount::text as snap_amount,
           md.campaign_id, dt.snap_campaign_id, c1.name as campaign_name, c0.name as snap_campaign_name,
           md.payment_status::text as status, dt.snap_status,
           md.payment_date::text as pdate, dt.snap_date::text as snap_date,
           md.deposit_id as current_deposit
    from deposit_transactions dt
    join deposits d on d.id = dt.deposit_id and d.location_id = ${locationId}
    join manual_donation md on md.id = dt.manual_donation_id
    left join contact ct on ct.id = md.contact_id
    left join campaign c1 on c1.id = md.campaign_id
    left join campaign c0 on c0.id = dt.snap_campaign_id
    where dt.deposit_id = any(${intArray(depositIds)})
      and dt.snapped_at is not null
      and (md.amount is distinct from dt.snap_amount
        or md.campaign_id is distinct from dt.snap_campaign_id
        or md.payment_status::text is distinct from dt.snap_status
        or md.payment_date is distinct from dt.snap_date
        or md.deposit_id is distinct from dt.deposit_id)
    order by dt.deposit_id, md.id`);

  for (const r of list) {
    const changes: string[] = [];
    if (r.amount !== r.snap_amount) changes.push(`amount ${usd(r.snap_amount as string | null)} → ${usd(r.amount as string | null)}`);
    if (r.campaign_id !== r.snap_campaign_id) changes.push(`fund ${(r.snap_campaign_name as string | null) ?? "none"} → ${(r.campaign_name as string | null) ?? "none"}`);
    if (r.status !== r.snap_status) changes.push(`status ${r.snap_status ?? "?"} → ${r.status}`);
    if (r.pdate !== r.snap_date) changes.push(`date ${r.snap_date ?? "?"} → ${r.pdate}`);
    if (r.current_deposit !== r.deposit_id) changes.push("no longer linked to this deposit");
    const depositId = Number(r.deposit_id);
    const entry: GiftDrift = {
      depositId,
      giftId: Number(r.gift_id),
      donor: [r.first_name, r.last_name].filter(Boolean).join(" ") || "Unknown",
      changes,
    };
    out.set(depositId, [...(out.get(depositId) ?? []), entry]);
  }
  return out;
}

const summary = (d: GiftDrift[]) => d.slice(0, 3).map((g) => `${g.donor}: ${g.changes.join(", ")}`).join("; ") + (d.length > 3 ? `; and ${d.length - 3} more` : "");

/** Why a closed (not yet sent) deposit must not go out as it is. */
export function blockMessage(depositId: number, d: GiftDrift[]): string {
  return `Deposit #${depositId} has ${d.length} ${d.length === 1 ? "gift" : "gifts"} changed since it was closed (${summary(d)}). Reopen the deposit and close it again so the entry matches, or void it.`;
}

/** Deposits already sent to accounting whose gifts changed afterwards: they need an adjusting entry there. */
export async function sentDepositAlerts(locationId: string): Promise<string[]> {
  const sent = await rows(sql`
    select id, deposit_date::text as deposit_date from deposits
    where location_id = ${locationId} and status = 'exported'
    order by id desc limit 200`);
  const drift = await driftFor(locationId, sent.map((s) => Number(s.id)));
  return sent
    .filter((s) => drift.has(Number(s.id)))
    .map((s) => {
      const d = drift.get(Number(s.id))!;
      return `Deposit #${s.id} (${s.deposit_date}) was sent to accounting, but ${d.length} ${d.length === 1 ? "gift" : "gifts"} changed afterwards (${summary(d)}). Enter an adjusting entry in your accounting system; DonorHQ does not change entries that were already sent.`;
    });
}
