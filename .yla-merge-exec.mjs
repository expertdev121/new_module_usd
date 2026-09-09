/**
 * YLA duplicate-contact merge (DonorHQ side).
 *
 * For each (dropId, keepId) pair: reassigns pledges, manual donations,
 * third-party payment attribution, student/contact roles, relationships,
 * solicitor record, and contact tags from dropId onto keepId, then deletes
 * the dropId contact row. Verifies USD giving totals are preserved
 * (sum(drop)+sum(keep) before === sum(keep) after) before/after each merge.
 *
 * Usage:
 *   node .yla-merge-exec.mjs                 # dry run, prints plan + would-be totals
 *   node .yla-merge-exec.mjs --apply         # actually executes + writes report CSV
 *   node .yla-merge-exec.mjs --apply --pairs=path/to/pairs.json
 */
import { neon } from "@neondatabase/serverless";
import fs from "fs";

const envText = fs.readFileSync(new URL("./.env", import.meta.url), "utf8");
for (const line of envText.split("\n")) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

const sql = neon(process.env.DATABASE_URL);
const APPLY = process.argv.includes("--apply");
const pairsArgIdx = process.argv.findIndex((a) => a.startsWith("--pairs="));
const pairsPath = pairsArgIdx >= 0 ? process.argv[pairsArgIdx].split("=")[1] : ".tmp-yla/merge-pairs.json";

const pairs = JSON.parse(fs.readFileSync(pairsPath, "utf8"));
console.log(`Loaded ${pairs.length} pairs from ${pairsPath}. Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);

async function givingTotal(contactId) {
  const [row] = await sql`
    SELECT
      COALESCE((SELECT SUM(p.amount_usd) FROM payment p JOIN pledge pl ON p.pledge_id = pl.id WHERE pl.contact_id = ${contactId}), 0)
      + COALESCE((SELECT SUM(amount_usd) FROM payment WHERE payer_contact_id = ${contactId}), 0)
      + COALESCE((SELECT SUM(amount_usd) FROM manual_donation WHERE contact_id = ${contactId}), 0)
      AS total
  `;
  return Number(row.total);
}

async function counts(contactId) {
  const [row] = await sql`
    SELECT
      (SELECT COUNT(*) FROM payment p JOIN pledge pl ON p.pledge_id = pl.id WHERE pl.contact_id = ${contactId}) AS pledge_payments,
      (SELECT COUNT(*) FROM payment WHERE payer_contact_id = ${contactId}) AS thirdparty_payments,
      (SELECT COUNT(*) FROM manual_donation WHERE contact_id = ${contactId}) AS manual_donations,
      (SELECT COUNT(*) FROM contact_tags WHERE contact_id = ${contactId}) AS tags
  `;
  return {
    payments: Number(row.pledge_payments) + Number(row.thirdparty_payments) + Number(row.manual_donations),
    tags: Number(row.tags),
  };
}

const report = [];
let failCount = 0;

for (const { drop_id, keep_id } of pairs) {
  const dropId = Number(drop_id);
  const keepId = Number(keep_id);

  const [dropExists] = await sql`SELECT id FROM contact WHERE id = ${dropId}`;
  if (!dropExists) {
    report.push({ drop_id: dropId, keep_id: keepId, status: "skipped_drop_missing" });
    continue;
  }

  const dropTotalBefore = await givingTotal(dropId);
  const keepTotalBefore = await givingTotal(keepId);
  const dropCounts = await counts(dropId);
  const combinedBefore = Math.round((dropTotalBefore + keepTotalBefore) * 100) / 100;

  if (APPLY) {
    await sql.transaction([
      sql`UPDATE pledge SET contact_id = ${keepId} WHERE contact_id = ${dropId}`,
      sql`UPDATE manual_donation SET contact_id = ${keepId} WHERE contact_id = ${dropId}`,
      sql`UPDATE student_roles SET contact_id = ${keepId} WHERE contact_id = ${dropId}`,
      sql`UPDATE contact_roles SET contact_id = ${keepId} WHERE contact_id = ${dropId}`,
      sql`UPDATE payment SET payer_contact_id = ${keepId} WHERE payer_contact_id = ${dropId}`,
      sql`UPDATE payment_allocations SET payer_contact_id = ${keepId} WHERE payer_contact_id = ${dropId}`,
      sql`UPDATE crowded_payment_plans SET contact_id = ${keepId} WHERE contact_id = ${dropId}`,
      sql`UPDATE solicitor SET contact_id = ${keepId} WHERE contact_id = ${dropId} AND NOT EXISTS (SELECT 1 FROM solicitor s2 WHERE s2.contact_id = ${keepId})`,
      sql`INSERT INTO contact_tags (contact_id, tag_id, created_at)
          SELECT ${keepId}, tag_id, created_at FROM contact_tags WHERE contact_id = ${dropId}
          ON CONFLICT (contact_id, tag_id) DO NOTHING`,
      sql`INSERT INTO relationships (contact_id, related_contact_id, relationship_type, is_active, notes, location_id, created_at, updated_at)
          SELECT ${keepId}, related_contact_id, relationship_type, is_active, notes, location_id, created_at, updated_at
          FROM relationships WHERE contact_id = ${dropId} AND related_contact_id <> ${keepId}
          ON CONFLICT (contact_id, related_contact_id, relationship_type) DO NOTHING`,
      sql`INSERT INTO relationships (contact_id, related_contact_id, relationship_type, is_active, notes, location_id, created_at, updated_at)
          SELECT contact_id, ${keepId}, relationship_type, is_active, notes, location_id, created_at, updated_at
          FROM relationships WHERE related_contact_id = ${dropId} AND contact_id <> ${keepId}
          ON CONFLICT (contact_id, related_contact_id, relationship_type) DO NOTHING`,
      sql`DELETE FROM contact WHERE id = ${dropId}`,
    ]);
  }

  const keepTotalAfter = APPLY ? await givingTotal(keepId) : keepTotalBefore + dropTotalBefore;
  const mismatch = Math.abs(Math.round((keepTotalAfter - combinedBefore) * 100) / 100) > 0.01;
  if (mismatch) failCount++;

  report.push({
    drop_id: dropId,
    keep_id: keepId,
    status: APPLY ? (mismatch ? "APPLIED_MISMATCH" : "applied") : "dry_run",
    payments_moved: dropCounts.payments,
    tags_moved: dropCounts.tags,
    usd_moved: dropTotalBefore.toFixed(2),
    keep_total_before: keepTotalBefore.toFixed(2),
    keep_total_after: keepTotalAfter.toFixed(2),
    combined_expected: combinedBefore.toFixed(2),
  });
}

fs.mkdirSync(".tmp-yla", { recursive: true });
const outPath = `.tmp-yla/merge-report-${APPLY ? "applied" : "dryrun"}.csv`;
const header = "drop_id,keep_id,status,payments_moved,tags_moved,usd_moved,keep_total_before,keep_total_after,combined_expected";
const lines = [header, ...report.map((r) => Object.values(r).map((v) => `"${v}"`).join(","))];
fs.writeFileSync(outPath, lines.join("\n"));

const totalUsd = report.reduce((a, r) => a + (parseFloat(r.usd_moved) || 0), 0);
const totalPayments = report.reduce((a, r) => a + (r.payments_moved || 0), 0);
const totalTags = report.reduce((a, r) => a + (r.tags_moved || 0), 0);
console.log(`Processed ${report.length} pairs. Mismatches: ${failCount}.`);
console.log(`Total payments moved: ${totalPayments}, tags moved: ${totalTags}, usd moved: $${totalUsd.toFixed(2)}`);
console.log(`Report written to ${outPath}`);
