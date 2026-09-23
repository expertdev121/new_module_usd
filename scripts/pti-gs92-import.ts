// scripts/pti-gs92-import.ts — GS-92: import the reconciled net-new PTI
// ShulCloud donations (transactions-11.csv) for the 2 test accounts
// (Schild, Greenbaum), following the exact conventions of the prior
// historical .import-pti.mjs import (household/contact resolution,
// reference_number dedup, import_source='claude_code').
//
// Dry-run by default. Pass --apply to write.
//
// Scope (per fresh reconciliation in scripts/pti-gs92-reconcile.ts, which
// exactly matches the user's quoted numbers):
//   - "132 payments"    = orphan Payment rows (no paired Credit), Status=
//     Closed, Date <= today. Of these, 129 are already in manual_donation
//     from the historical import; 3 are net-new. These lack a Credit row's
//     Type (campaign), so their notes get a "[NEEDS REVIEW: campaign from
//     Notes]" marker for later review per the user's request.
//   - "14 future-dated installments" = orphan Payment rows, Status=
//     Scheduled, Date > today. NOT imported — these are ShulCloud's
//     pre-generated future recurring-charge placeholders, no money has
//     moved yet.
//   - "105 credits with no payment" = unmatched Credit rows (a fund/pledge
//     was recorded but no equal-amount payment exists for it in this
//     export — i.e. an open/unpaid pledge balance). NOT imported as
//     donations (no money received). Logged for manual follow-up.
//   - Matched Credit+Payment pairs, non-future: 509 total, 495 already
//     imported, 14 net-new — imported normally with campaign = Credit's
//     Type (this is the well-attributed case, same as the original historical
//     import's model).

import { config } from "dotenv";
config();
import fs from "node:fs";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

function inList(values: string[]) {
  return sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
}

const APPLY = process.argv.includes("--apply");
const LOC = "92T9l8F6sMASmiOWLMP5";
const IMPORT_SOURCE = "claude_code";
const CSV_PATH = "C:/Users/kakli/Downloads/transactions-11.csv";
const TEST_ACCOUNTS = ["Schild, Gary & Ilana", "Greenbaum, Steven"];
const TODAY = "2026-09-22";
const REVIEW_MARKER = "[NEEDS REVIEW: campaign inferred from Notes — no paired Credit row]";

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

function mapMethod(type: string): string {
  const t = (type || "").toLowerCase();
  if (t.includes("credit") || t.includes("card")) return "credit_card";
  if (t.includes("ach")) return "ach";
  if (t.includes("check")) return "check";
  if (t.includes("paypal")) return "paypal";
  if (t.includes("cash")) return "cash";
  return "other";
}
function normStatus(reversalType: string, notes: string): string {
  if (reversalType || /refund|revers/i.test(notes || "")) return "refunded";
  return "completed";
}
function cleanStr(s: string | null): string | null {
  const v = (s || "").trim();
  return v === "-" ? null : v || null;
}

interface PlanRow {
  kind: "matched" | "orphan_payment";
  accountExtId: string;
  account: string;
  date: string;
  amount: string;
  paymentMethod: string;
  paymentStatus: string;
  referenceNumber: string;
  notes: string;
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

  const groups = new Map<string, string[][]>();
  for (const r of testRows) {
    const key = `${g(r, "Account ID")}|${g(r, "Date Entered")}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const matchedRows: { c: string[]; p: string[] }[] = [];
  const unmatchedCredits: string[][] = [];
  const unmatchedPayments: string[][] = [];

  for (const [, grp] of groups) {
    const credits = grp.filter((r) => g(r, "ID").startsWith("C"));
    const payments = grp.filter((r) => g(r, "ID").startsWith("P"));
    const used = new Set<string>();
    for (const c of credits) {
      const amt = parseFloat(g(c, "Charge") || "0");
      const p = payments.find((p) => !used.has(g(p, "ID")) && parseFloat(g(p, "Payment") || "0") === amt);
      if (p) {
        used.add(g(p, "ID"));
        matchedRows.push({ c, p });
      } else {
        unmatchedCredits.push(c);
      }
    }
    for (const p of payments) if (!used.has(g(p, "ID"))) unmatchedPayments.push(p);
  }

  const matchedNonFuture = matchedRows.filter((m) => g(m.c, "Date") <= TODAY);
  const orphanNonFuture = unmatchedPayments.filter((p) => g(p, "Date") <= TODAY);
  const orphanFuture = unmatchedPayments.filter((p) => g(p, "Date") > TODAY);

  // Existing refs for dedup (mirrors .import-pti.mjs: dedup by reference_number)
  const existing = await db.execute(sql`SELECT reference_number FROM manual_donation WHERE location_id = ${LOC} AND reference_number IS NOT NULL`);
  const existingRefs = new Set((existing.rows as { reference_number: string }[]).map((r) => r.reference_number));

  const plan: PlanRow[] = [];

  for (const { c, p } of matchedNonFuture) {
    const ref = g(p, "Internal ID");
    if (existingRefs.has(ref) || existingRefs.has(g(c, "Internal ID"))) continue;
    const campaign = g(c, "Type") || "Donation";
    const notes = cleanStr(g(c, "Notes")) || cleanStr(g(p, "Notes"));
    const combined = [notes, `PTI Type: ${campaign}`].filter(Boolean).join(" | ");
    plan.push({
      kind: "matched",
      accountExtId: g(c, "Account ID"),
      account: g(c, "Account"),
      date: g(c, "Date"),
      amount: parseFloat(g(c, "Charge") || "0").toFixed(2),
      paymentMethod: mapMethod(g(p, "Type")),
      paymentStatus: normStatus(g(p, "Reversal Type"), g(p, "Notes")),
      referenceNumber: ref,
      notes: combined,
    });
  }

  for (const p of orphanNonFuture) {
    const ref = g(p, "Internal ID");
    if (existingRefs.has(ref)) continue;
    const notes = cleanStr(g(p, "Notes"));
    const combined = [REVIEW_MARKER, notes, `PTI Type: ${g(p, "Type")} (payment method, no fund/campaign recorded)`]
      .filter(Boolean)
      .join(" | ");
    plan.push({
      kind: "orphan_payment",
      accountExtId: g(p, "Account ID"),
      account: g(p, "Account"),
      date: g(p, "Date"),
      amount: parseFloat(g(p, "Payment") || "0").toFixed(2),
      paymentMethod: mapMethod(g(p, "Type")),
      paymentStatus: normStatus(g(p, "Reversal Type"), g(p, "Notes")),
      referenceNumber: ref,
      notes: combined,
    });
  }

  console.log("────────── GS-92 PTI IMPORT PLAN (2 test accounts) ──────────\n");
  console.log(`Matched Credit+Payment pairs, non-future: ${matchedNonFuture.length} (net-new to insert: ${plan.filter((r) => r.kind === "matched").length})`);
  console.log(`Orphan payment rows, non-future ("132"): ${orphanNonFuture.length} (net-new to insert, tagged for review: ${plan.filter((r) => r.kind === "orphan_payment").length})`);
  console.log(`Orphan payment rows, future ("14"): ${orphanFuture.length} — EXCLUDED, not imported`);
  console.log(`Unmatched credit rows ("105"): ${unmatchedCredits.length} — EXCLUDED, not imported (no payment received; open pledge/balance)`);
  console.log(`\nTOTAL rows to insert: ${plan.length}, total $${plan.reduce((s, r) => s + parseFloat(r.amount), 0).toFixed(2)}`);
  console.log(`  of which tagged "${REVIEW_MARKER}": ${plan.filter((r) => r.kind === "orphan_payment").length}`);

  console.log("\n────────── Rows to insert ──────────");
  for (const r of plan) {
    console.log(`  [${r.kind}] ${r.date}  ${r.account}  $${r.amount}  method=${r.paymentMethod}  ref=${r.referenceNumber}  notes="${r.notes}"`);
  }

  if (!APPLY) {
    console.log("\n[dry-run] no changes written. Re-run with --apply.");
    process.exit(0);
  }

  console.log("\n────────── APPLY ──────────");

  // Resolve household + primary contact per account_ext_id (same pattern as
  // the historical .import-pti.mjs import).
  const acctIds = [...new Set(plan.map((r) => r.accountExtId))];
  const households = await db.execute(
    sql`SELECT id, external_id FROM household WHERE location_id = ${LOC} AND external_id IN (${inList(acctIds)})`,
  );
  const extToHhId = new Map((households.rows as { id: number; external_id: string }[]).map((h) => [h.external_id, h.id]));

  const primaries = await db.execute(
    sql`SELECT c.id AS contact_id, h.external_id FROM contact c JOIN household h ON c.household_id = h.id
        WHERE h.location_id = ${LOC} AND h.external_id IN (${inList(acctIds)}) AND c.is_primary_contact = TRUE`,
  );
  const acctToContactId = new Map((primaries.rows as { contact_id: number; external_id: string }[]).map((p) => [p.external_id, p.contact_id]));
  // fallback: any member if no primary
  for (const ext of acctIds) {
    if (!acctToContactId.has(ext)) {
      const hhId = extToHhId.get(ext);
      if (hhId) {
        const any = await db.execute(sql`SELECT id FROM contact WHERE household_id = ${hhId} LIMIT 1`);
        const row = any.rows[0] as { id: number } | undefined;
        if (row) acctToContactId.set(ext, row.id);
      }
    }
  }
  console.log(`Resolved ${acctToContactId.size}/${acctIds.length} account(s) to a contact.`);

  let inserted = 0;
  let skippedNoContact = 0;
  for (const r of plan) {
    const contactId = acctToContactId.get(r.accountExtId);
    const householdId = extToHhId.get(r.accountExtId);
    if (!contactId) {
      skippedNoContact++;
      console.log(`  SKIP (no contact resolved): ${r.account} ref=${r.referenceNumber}`);
      continue;
    }
    await db.execute(sql`
      INSERT INTO manual_donation (
        contact_id, household_id, amount, currency, amount_usd, exchange_rate,
        payment_date, received_date, payment_method, payment_status,
        reference_number, notes, location_id, import_source, receipt_issued
      ) VALUES (
        ${contactId}, ${householdId ?? null}, ${r.amount}, 'USD', ${r.amount}, '1.0000',
        ${r.date}, ${r.date}, ${r.paymentMethod}, ${r.paymentStatus},
        ${r.referenceNumber}, ${r.notes}, ${LOC}, ${IMPORT_SOURCE}, false
      )
      ON CONFLICT DO NOTHING
    `);
    inserted++;
  }

  console.log(`\nInserted: ${inserted}, skipped (no contact): ${skippedNoContact}`);

  const [verify] = (
    await db.execute(
      sql`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS sum FROM manual_donation WHERE location_id = ${LOC} AND import_source = ${IMPORT_SOURCE}`,
    )
  ).rows as { cnt: string; sum: string }[];
  console.log(`\nTotal manual_donation rows for PTI with import_source='claude_code' (all-time, both this and the historical run): ${verify.cnt} rows, $${parseFloat(verify.sum).toFixed(2)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
