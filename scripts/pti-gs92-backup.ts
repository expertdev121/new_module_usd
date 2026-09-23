// scripts/pti-gs92-backup.ts — READ-ONLY. Full backup of PTI data before
// the GS-92 ShulCloud (transactions-11.csv) import for the 2 test accounts.
// Mirrors the cmn-backup.ts pattern: full-fidelity JSON snapshot + CSVs.

import { config } from "dotenv";
config();
import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/db";
import { contact, manualDonation } from "../lib/db/schema";
import { eq, sql } from "drizzle-orm";

const LOC = "92T9l8F6sMASmiOWLMP5";

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
}

async function main() {
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(".tmp-pti", `backup-${ts}`);
  fs.mkdirSync(dir, { recursive: true });

  const households = await db.execute(
    sql`SELECT * FROM household WHERE location_id = ${LOC}`,
  );
  const contacts = await db.select().from(contact).where(eq(contact.locationId, LOC));
  const donations = await db.select().from(manualDonation).where(eq(manualDonation.locationId, LOC));

  fs.writeFileSync(
    path.join(dir, "snapshot.json"),
    JSON.stringify({ locationId: LOC, takenAt: new Date().toISOString(), households: households.rows, contacts, donations }, null, 2),
  );
  fs.writeFileSync(path.join(dir, "households.csv"), toCsv(households.rows as Record<string, unknown>[]));
  fs.writeFileSync(path.join(dir, "contacts.csv"), toCsv(contacts as unknown as Record<string, unknown>[]));
  fs.writeFileSync(path.join(dir, "manual_donations.csv"), toCsv(donations as unknown as Record<string, unknown>[]));

  console.log(`Backup written to ${dir}`);
  console.log(`  households: ${households.rows.length}`);
  console.log(`  contacts: ${contacts.length}`);
  console.log(`  manual_donations: ${donations.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Backup failed:", err);
    process.exit(1);
  });
