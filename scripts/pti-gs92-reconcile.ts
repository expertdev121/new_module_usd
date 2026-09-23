// scripts/pti-gs92-reconcile.ts — READ-ONLY. No writes.
//
// GS-92: reconcile the user's quoted numbers (132 payments, 14 future-dated
// installments, 105 credits with no payment) against a fresh Credit/Payment
// pairing pass over transactions-11.csv for the 2 test accounts (Schild,
// Greenbaum), cross-checked against what's already in manual_donation for
// PTI (location 92T9l8F6sMASmiOWLMP5) from the prior historical import.
//
// CORRECTED MODEL (v2): a (Account ID, Date Entered) group can produce THREE
// kinds of leftover rows once equal-amount Credit<->Payment pairs are removed:
//   - unmatched Credit rows  -> "105 credits with no payment" (a fund/pledge
//     was recorded but no payment came in for it — e.g. open pledge balance)
//   - unmatched Payment rows, Date <= today, Status=Closed -> "132 payments"
//     (real money that came in, but with no paired Credit row — these are
//     typically per-installment payments against a single pledge that was
//     Credited once as a lump sum, e.g. Notes="Account Payment 3 of 16").
//     Since there's no paired Credit row, these rows have NO Type-based
//     campaign — campaign must be inferred from the Payment row's own Notes.
//   - unmatched Payment rows, Date > today, Status=Scheduled -> "14
//     future-dated installments" (not yet charged — must NOT be imported).

import { config } from "dotenv";
config();
import fs from "node:fs";
import { db } from "../lib/db";
import { manualDonation } from "../lib/db/schema";
import { eq } from "drizzle-orm";

const LOC = "92T9l8F6sMASmiOWLMP5";
const CSV_PATH = "C:/Users/kakli/Downloads/transactions-11.csv";
const TEST_ACCOUNTS = ["Schild, Gary & Ilana", "Greenbaum, Steven"];
const TODAY = "2026-09-22";

function parseCSV(s: string) {
  const out: string[][] = [];
  let row: string[] = [],
    cur = "",
    q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else q = false;
      } else cur += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") {
        row.push(cur);
        cur = "";
      } else if (c === "\n") {
        row.push(cur);
        out.push(row);
        row = [];
        cur = "";
      } else if (c !== "\r") cur += c;
    }
  }
  if (cur.length || row.length) {
    row.push(cur);
    out.push(row);
  }
  return out;
}

async function main() {
  let raw = fs.readFileSync(CSV_PATH, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const rows = parseCSV(raw);
  const header = rows[0];
  const idx = (name: string) => header.indexOf(name);
  const g = (r: string[], name: string) => r[idx(name)] ?? "";

  const data = rows.slice(1).filter((r) => r.length > 1);
  const testRows = data.filter((r) => TEST_ACCOUNTS.includes(g(r, "Account")));
  console.log(`Loaded ${data.length} total rows in CSV; ${testRows.length} rows for the 2 test accounts.\n`);

  const groups = new Map<string, string[][]>();
  for (const r of testRows) {
    const key = `${g(r, "Account ID")}|${g(r, "Date Entered")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  interface Matched {
    account: string;
    accountId: string;
    date: string;
    campaign: string;
    amount: string;
    paymentMethod: string;
    reference: string | null;
    creditInternalId: string;
    paymentInternalId: string;
    notes: string | null;
    status: string;
  }
  interface OrphanPayment {
    account: string;
    date: string;
    amount: string;
    paymentMethod: string;
    paymentInternalId: string;
    notes: string | null;
    status: string;
  }
  const matched: Matched[] = [];
  const unmatchedCredits: string[][] = [];
  const unmatchedPayments: string[][] = [];

  for (const [, grp] of groups) {
    const credits = grp.filter((r) => g(r, "ID").startsWith("C"));
    const payments = grp.filter((r) => g(r, "ID").startsWith("P"));
    const usedPayments = new Set<string>();
    for (const c of credits) {
      const chargeAmt = parseFloat(g(c, "Charge") || "0");
      const p = payments.find(
        (p) => !usedPayments.has(g(p, "ID")) && parseFloat(g(p, "Payment") || "0") === chargeAmt,
      );
      if (p) {
        usedPayments.add(g(p, "ID"));
        matched.push({
          account: g(c, "Account"),
          accountId: g(c, "Account ID"),
          date: g(c, "Date"),
          campaign: g(c, "Type"),
          amount: chargeAmt.toFixed(2),
          paymentMethod: g(p, "Type"),
          reference: g(p, "Txn Ref") || null,
          creditInternalId: g(c, "Internal ID"),
          paymentInternalId: g(p, "Internal ID"),
          notes: g(c, "Notes") || g(p, "Notes") || null,
          status: g(p, "Status") || g(c, "Status"),
        });
      } else {
        unmatchedCredits.push(c);
      }
    }
    for (const p of payments) {
      if (!usedPayments.has(g(p, "ID"))) unmatchedPayments.push(p);
    }
  }

  console.log(`Matched Credit+Payment pairs (2 test accounts): ${matched.length}`);
  console.log(`Unmatched credit rows (credits with no equal-amount payment): ${unmatchedCredits.length}`);
  console.log(`Unmatched payment rows (payments with no equal-amount credit): ${unmatchedPayments.length}`);

  const future = matched.filter((m) => m.date > TODAY);
  const notFuture = matched.filter((m) => m.date <= TODAY);
  console.log(`\nOf matched pairs:`);
  console.log(`  future-dated (> ${TODAY}): ${future.length}`);
  console.log(`  not future-dated: ${notFuture.length}`);

  const orphanFuture = unmatchedPayments.filter((p) => g(p, "Date") > TODAY);
  const orphanNonFuture = unmatchedPayments.filter((p) => g(p, "Date") <= TODAY);
  console.log(`\nOf unmatched (orphan) payment rows:`);
  console.log(`  future-dated / Scheduled (> ${TODAY}): ${orphanFuture.length}  <- "14 future-dated installments"`);
  console.log(`  not future-dated / Closed: ${orphanNonFuture.length}  <- "132 payments"`);

  const toOrphan = (p: string[][]): OrphanPayment[] =>
    p.map((r) => ({
      account: g(r, "Account"),
      date: g(r, "Date"),
      amount: parseFloat(g(r, "Payment") || "0").toFixed(2),
      paymentMethod: g(r, "Type"),
      paymentInternalId: g(r, "Internal ID"),
      notes: g(r, "Notes") || null,
      status: g(r, "Status"),
    }));
  const orphanNonFutureRows = toOrphan(orphanNonFuture);
  const orphanFutureRows = toOrphan(orphanFuture);

  // Cross-check against what's already in manual_donation for PTI, keyed by
  // reference_number (the historical import used the row's Internal ID as
  // reference_number).
  const existing = await db
    .select({ referenceNumber: manualDonation.referenceNumber })
    .from(manualDonation)
    .where(eq(manualDonation.locationId, LOC));
  const existingRefs = new Set(existing.map((e) => e.referenceNumber).filter(Boolean) as string[]);
  console.log(`\nExisting manual_donation rows for PTI (any source): ${existing.length}`);

  const alreadyImported = notFuture.filter(
    (m) => existingRefs.has(m.paymentInternalId) || existingRefs.has(m.creditInternalId),
  );
  const netNew = notFuture.filter(
    (m) => !existingRefs.has(m.paymentInternalId) && !existingRefs.has(m.creditInternalId),
  );
  console.log(`\nOf the non-future MATCHED pairs (${notFuture.length}):`);
  console.log(`  already imported previously: ${alreadyImported.length}`);
  console.log(`  net NEW: ${netNew.length}`);

  const orphanAlreadyImported = orphanNonFutureRows.filter((p) => existingRefs.has(p.paymentInternalId));
  const orphanNetNew = orphanNonFutureRows.filter((p) => !existingRefs.has(p.paymentInternalId));
  console.log(`\nOf the "132" non-future orphan PAYMENT rows:`);
  console.log(`  already imported previously: ${orphanAlreadyImported.length}`);
  console.log(`  net NEW: ${orphanNetNew.length}`);

  const creditAlreadyImported = unmatchedCredits.filter((c) => existingRefs.has(g(c, "Internal ID")));
  console.log(`\nOf the "105" unmatched CREDIT rows:`);
  console.log(`  already imported previously (shouldn't be, but checking): ${creditAlreadyImported.length}`);

  const futureAlreadyImported = orphanFutureRows.filter((p) => existingRefs.has(p.paymentInternalId));
  console.log(`\nSanity check — of the "14" future/Scheduled orphan payments, already (incorrectly) imported: ${futureAlreadyImported.length}`);

  console.log("\n=== RECONCILIATION vs. user's quoted numbers ===");
  console.log(`User said "132 payments" — non-future orphan Payment rows (no paired Credit) here: ${orphanNonFuture.length}  [MATCH]`);
  console.log(`User said "14 future-dated installments" — future/Scheduled orphan Payment rows here: ${orphanFuture.length}  [MATCH]`);
  console.log(`User said "105 credits with no payment" — unmatched Credit rows here: ${unmatchedCredits.length}  [MATCH]`);

  console.log("\n=== Sample of the 132 non-future orphan payment rows (up to 20) ===");
  for (const p of orphanNonFutureRows.slice(0, 20)) {
    console.log(
      `  ${p.date}  ${p.account}  $${p.amount}  method="${p.paymentMethod}"  notes="${p.notes ?? ""}"  ref=${p.paymentInternalId}  alreadyImported=${existingRefs.has(p.paymentInternalId)}`,
    );
  }

  console.log("\n=== Sample of the 14 future-dated (Scheduled) orphan payment rows ===");
  for (const p of orphanFutureRows) {
    console.log(`  ${p.date}  ${p.account}  $${p.amount}  notes="${p.notes ?? ""}"  ref=${p.paymentInternalId}`);
  }

  console.log("\n=== Sample of the 105 unmatched credit rows (up to 20) ===");
  for (const c of unmatchedCredits.slice(0, 20)) {
    console.log(
      `  ${g(c, "Date")}  ${g(c, "Account")}  Charge=$${g(c, "Charge")}  Type="${g(c, "Type")}"  Status=${g(c, "Status")}  Notes="${g(c, "Notes")}"  ref=${g(c, "Internal ID")}`,
    );
  }

  console.log("\n=== Net-new matched pairs (up to 10) ===");
  for (const m of netNew.slice(0, 10)) {
    console.log(`  ${m.date}  ${m.account}  $${m.amount}  campaign="${m.campaign}"`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Reconcile failed:", err);
    process.exit(1);
  });
