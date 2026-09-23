// scripts/cmn-check-failures.ts — READ-ONLY. Diagnoses the 3 payment
// insert failures from the cmn-sync.ts run by recomputing the same
// dedup logic and diffing against what actually landed in manual_donation.

import { config } from "dotenv";
config();
import { db } from "../lib/db";
import { manualDonation } from "../lib/db/schema";
import { eq } from "drizzle-orm";
import {
  listTransactionsFromGhl,
  listInvoicesFromGhl,
  listOrdersFromGhl,
  listSubscriptionsFromGhl,
  type GhlPaymentRecord,
  type GhlPaymentListPage,
} from "../lib/ghl/api-client";

const LOCATION_ID = "4Nzcp3vUgVbOoN9uxu5F";
type PaymentWithSource = GhlPaymentRecord & { __source: string };

function dateOnly(s: string | null) {
  if (!s) return "unknown";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "unknown" : d.toISOString().slice(0, 10);
}

async function fetchAllPayments(
  fn: (locationId: string, opts: { limit?: number; cursor?: string | null }) => Promise<GhlPaymentListPage>,
  source: string,
): Promise<PaymentWithSource[]> {
  let out: PaymentWithSource[] = [];
  let cursor: string | null | undefined = undefined;
  for (;;) {
    const page = await fn(LOCATION_ID, { limit: 100, cursor });
    out = out.concat(page.records.map((r) => ({ ...r, __source: source })));
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

async function main() {
  const transactions = await fetchAllPayments(listTransactionsFromGhl, "ghl_transaction");
  const invoices = await fetchAllPayments(listInvoicesFromGhl, "ghl_invoice");
  const orders = await fetchAllPayments(listOrdersFromGhl, "ghl_order");
  const subscriptions = await fetchAllPayments(listSubscriptionsFromGhl, "ghl_subscription");
  const allPayments = [...transactions, ...invoices, ...orders, ...subscriptions];

  const existingDonations = await db
    .select({ ghlResourceId: manualDonation.ghlResourceId })
    .from(manualDonation)
    .where(eq(manualDonation.locationId, LOCATION_ID));
  const existingIds = new Set(existingDonations.map((d) => d.ghlResourceId).filter(Boolean) as string[]);

  // IMPORTANT: cluster over ALL fetched payments (not just "missing"), so a
  // duplicate whose "kept" sibling already landed in DB isn't miscounted as
  // a fresh singleton. This mirrors cmn-sync.ts's logic exactly regardless
  // of when this diagnostic is re-run.
  const clusters = new Map<string, PaymentWithSource[]>();
  for (const p of allPayments) {
    if (!p.id) continue;
    const key = `${p.contactId ?? "none"}|${(p.amount ?? 0).toFixed(2)}|${dateOnly(p.paidAt)}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key)!.push(p);
  }
  const intendedToExist: PaymentWithSource[] = [];
  for (const [, group] of clusters) {
    const distinctSources = new Set(group.map((g) => g.__source));
    if (distinctSources.size > 1) {
      const sorted = [...group].sort(
        (a, b) => new Date(a.paidAt ?? 0).getTime() - new Date(b.paidAt ?? 0).getTime(),
      );
      intendedToExist.push(sorted[0]);
    } else {
      intendedToExist.push(...group);
    }
  }

  console.log(`\nPayments that SHOULD exist in DonorHQ (post-dedup) but don't — real failures:\n`);
  const stillMissing = intendedToExist.filter((p) => !existingIds.has(p.id!));
  for (const p of stillMissing) {
    console.log(
      `  id=${p.id} source=${p.__source} contactId=${p.contactId ?? "NULL"} amount=${p.amount} currency=${p.currency} paidAt=${p.paidAt} status=${p.status} description=${p.description ?? "-"}`,
    );
  }
  console.log(`\nTotal still missing: ${stillMissing.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Check failed:", err);
    process.exit(1);
  });
