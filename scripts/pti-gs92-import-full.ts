// scripts/pti-gs92-import-full.ts — GS-92: import the reconciled net-new PTI
// ShulCloud donations (transactions-11.csv) for THE FULL FILE (all accounts),
// following the exact conventions validated by the 2-account test run
// (scripts/pti-gs92-import.ts) and the historical .import-pti.mjs import
// (household/contact resolution, reference_number dedup,
// import_source='claude_code').
//
// Dry-run by default. Pass --apply to write.
//
// Scope (same model as the 2-account test, applied to every account in the
// CSV):
//   - Matched Credit+Payment pairs, non-future -> imported, campaign =
//     Credit's Type.
//   - Orphan Payment rows, non-future (Status=Closed, real money in, no
//     paired Credit) -> imported, campaign inferred from the Payment row's
//     own Notes, tagged "[NEEDS REVIEW: campaign inferred from Notes — no
//     paired Credit row]".
//   - Orphan Payment rows, future (Status=Scheduled, Date > today) -> NOT
//     imported (not yet charged).
//   - Unmatched Credit rows (pledge/fund recorded, no payment received) ->
//     NOT imported (no money moved).
//   - Dedup: skip any row whose reference_number (Internal ID) already
//     exists in manual_donation for this location — covers both the prior
//     historical import and the 2-account test run.

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
  console.log(`Loaded ${data.length} total rows in CSV (all accounts).\n`);

  const groups = new Map<string, string[][]>();
  for (const r of data) {
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

  console.log(`Matched Credit+Payment pairs (all accounts): ${matchedRows.length}`);
  console.log(`Unmatched credit rows (open pledge/balance, no payment): ${unmatchedCredits.length}`);
  console.log(`Unmatched payment rows: ${unmatchedPayments.length}  (future/Scheduled: ${orphanFuture.length}, non-future/Closed: ${orphanNonFuture.length})`);

  // Existing refs for dedup (mirrors .import-pti.mjs + the 2-account test
  // run: dedup by reference_number, covers historical + test-run rows).
  const existing = await db.execute(sql`SELECT reference_number FROM manual_donation WHERE location_id = ${LOC} AND reference_number IS NOT NULL`);
  const existingRefs = new Set((existing.rows as { reference_number: string }[]).map((r) => r.reference_number));
  console.log(`Existing manual_donation rows for PTI (any source): ${existingRefs.size} unique reference_numbers`);

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

  console.log("\n────────── GS-92 PTI IMPORT PLAN (FULL FILE) ──────────\n");
  console.log(`Matched Credit+Payment pairs, non-future: ${matchedNonFuture.length} (net-new to insert: ${plan.filter((r) => r.kind === "matched").length})`);
  console.log(`Orphan payment rows, non-future: ${orphanNonFuture.length} (net-new to insert, tagged for review: ${plan.filter((r) => r.kind === "orphan_payment").length})`);
  console.log(`Orphan payment rows, future: ${orphanFuture.length} — EXCLUDED, not imported`);
  console.log(`Unmatched credit rows: ${unmatchedCredits.length} — EXCLUDED, not imported (no payment received; open pledge/balance)`);
  console.log(`\nTOTAL rows to insert: ${plan.length}, total $${plan.reduce((s, r) => s + parseFloat(r.amount), 0).toFixed(2)}`);
  console.log(`  of which tagged "${REVIEW_MARKER}": ${plan.filter((r) => r.kind === "orphan_payment").length}`);

  const distinctAccounts = new Set(plan.map((r) => r.accountExtId));
  console.log(`  distinct accounts affected: ${distinctAccounts.size}`);

  console.log("\n────────── Sample of rows to insert (first 25) ──────────");
  for (const r of plan.slice(0, 25)) {
    console.log(`  [${r.kind}] ${r.date}  ${r.account}  $${r.amount}  method=${r.paymentMethod}  ref=${r.referenceNumber}`);
  }

  if (!APPLY) {
    console.log("\n[dry-run] no changes written. Re-run with --apply.");
    process.exit(0);
  }

  console.log("\n────────── APPLY ──────────");

  // Resolve household + primary contact per account_ext_id (same pattern as
  // the historical .import-pti.mjs import and the 2-account test run),
  // batched in chunks to keep the IN-list reasonable.
  const acctIds = [...distinctAccounts];
  const extToHhId = new Map<string, number>();
  const acctToContactId = new Map<string, number>();
  const CHUNK = 300;
  for (let i = 0; i < acctIds.length; i += CHUNK) {
    const chunk = acctIds.slice(i, i + CHUNK);
    const households = await db.execute(
      sql`SELECT id, external_id FROM household WHERE location_id = ${LOC} AND external_id IN (${inList(chunk)})`,
    );
    for (const h of households.rows as { id: number; external_id: string }[]) extToHhId.set(h.external_id, h.id);

    const primaries = await db.execute(
      sql`SELECT c.id AS contact_id, h.external_id FROM contact c JOIN household h ON c.household_id = h.id
          WHERE h.location_id = ${LOC} AND h.external_id IN (${inList(chunk)}) AND c.is_primary_contact = TRUE`,
    );
    for (const p of primaries.rows as { contact_id: number; external_id: string }[]) acctToContactId.set(p.external_id, p.contact_id);
  }
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
  const skippedAccounts = new Set<string>();
  for (const r of plan) {
    const contactId = acctToContactId.get(r.accountExtId);
    const householdId = extToHhId.get(r.accountExtId);
    if (!contactId) {
      skippedNoContact++;
      skippedAccounts.add(r.account);
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

  console.log(`\nInserted: ${inserted}, skipped (no contact resolved): ${skippedNoContact}`);
  if (skippedAccounts.size) {
    console.log(`Skipped accounts (no matching household/contact found — likely not in PTI's contact DB yet):`);
    for (const a of [...skippedAccounts].slice(0, 50)) console.log(`  - ${a}`);
    if (skippedAccounts.size > 50) console.log(`  ...and ${skippedAccounts.size - 50} more`);
  }

  const [verify] = (
    await db.execute(
      sql`SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS sum FROM manual_donation WHERE location_id = ${LOC} AND import_source = ${IMPORT_SOURCE}`,
    )
  ).rows as { cnt: string; sum: string }[];
  console.log(`\nTotal manual_donation rows for PTI with import_source='claude_code' (all-time): ${verify.cnt} rows, $${parseFloat(verify.sum).toFixed(2)}`);

  const [reviewCount] = (
    await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM manual_donation WHERE location_id = ${LOC} AND import_source = ${IMPORT_SOURCE} AND notes LIKE ${"%" + REVIEW_MARKER + "%"}`,
    )
  ).rows as { cnt: string }[];
  console.log(`Total tagged "NEEDS REVIEW" (all-time): ${reviewCount.cnt}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Import failed:", err);
    process.exit(1);
  });
