/**
 * Fix the 703 CSV Partner IDs that never got linked, applying the
 * standardized cascade (email → phone-if-no-email → constituents_id):
 *
 *  A. SAME-person cases (CSV email matches a JOL contact, or CSV row has
 *     no email and its phone matches):
 *       → donations stay/move onto that existing contact
 *       → the CSV Partner ID is recorded as an ALIAS in the matched
 *         contact's record via `record_id` field?  NO — record_id is used
 *         elsewhere. We only re-link donations; the alias mapping is
 *         written to a CSV report for the client.
 *
 *  B. UNIQUE cases (shared-phone-different-email, or no identifier match):
 *       → find-or-create a contact keyed by (location, constituents_id=partner)
 *       → move the donations I imported for that partner
 *         (reference_number LIKE 'partner|%') onto that contact.
 *         (These were previously attached by NAME matching, which the new
 *         rule forbids — so they may sit on the wrong same-named person.)
 *
 * Dry-run default; --apply to write.
 */
import fs from "node:fs";
import postgres from "postgres";

const APPLY = process.argv.includes("--apply");
const LOC = "KVgMIrEYRkKRcfeicJBm";
const CSV = "/Users/nikhil/Downloads/JUST_TransByFundEvent_112624 (3).csv";
const OUTDIR = "/Users/nikhil/Downloads/jol-audit";

const norm = s => (s||"").toString().trim().toLowerCase();
const normPhone = s => (s||"").toString().replace(/\D+/g,"");
const num = s => { const v = parseFloat((s||"").toString().replace(/[$,]/g,"")); return isNaN(v) ? 0 : v; };
function parseCSV(s){const out=[];let row=[],cur="",q=false;for(let i=0;i<s.length;i++){const c=s[i];if(q){if(c==='"'){if(s[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}else{if(c==='"')q=true;else if(c===','){row.push(cur);cur="";}else if(c==='\n'){row.push(cur);out.push(row);row=[];cur="";}else if(c!=='\r')cur+=c;}}if(cur.length||row.length){row.push(cur);out.push(row);}return out;}

const url = fs.readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g,"");
const sql = postgres(url,{ssl:"require",max:1});

try {
  let raw = fs.readFileSync(CSV,"utf8"); if (raw.charCodeAt(0)===0xFEFF) raw = raw.slice(1);
  const rows = parseCSV(raw); const h = rows[0]; const i = n => h.indexOf(n);
  const donors = new Map();
  for (const r of rows.slice(1).filter(x=>x.length>1)) {
    const p = r[i("Partner ID")]; if (!p) continue;
    if (!donors.has(p)) donors.set(p, {
      partner: p,
      first: (r[i("First Name")]||"").trim(), last: (r[i("Last Name")]||"").trim(),
      email: norm(r[i("Email")]), rawEmail: (r[i("Email")]||"").trim(),
      phone: normPhone(r[i("Phone Number")]), rawPhone: (r[i("Phone Number")]||"").trim(),
      org: (r[i("Organization")]||"").trim(),
      addr1: (r[i("Addr1")]||"").trim(), city: (r[i("City")]||"").trim(),
      state: (r[i("State")]||"").trim(), zip: (r[i("Postal Code")]||"").trim(),
    });
  }

  const linked = new Set((await sql`SELECT constituents_id FROM contact WHERE location_id=${LOC} AND constituents_id IS NOT NULL`).map(r=>r.constituents_id));
  const missing = [...donors.values()].filter(d => !linked.has(d.partner));
  console.log(`Unlinked Partner IDs: ${missing.length}`);

  const jol = await sql`SELECT id, email, phone, constituents_id FROM contact WHERE location_id=${LOC}`;
  const byEmail = new Map(); const byPhone = new Map();
  for (const c of jol) {
    const e = norm(c.email); if (e && !byEmail.has(e)) byEmail.set(e, c);
    const p = normPhone(c.phone); if (p.length>=7 && !byPhone.has(p)) byPhone.set(p, c);
  }

  const sameByEmail = [], sameByPhone = [], uniques = [];
  for (const d of missing) {
    if (d.email && byEmail.has(d.email)) { sameByEmail.push({ d, target: byEmail.get(d.email) }); continue; }
    if (!d.email && d.phone.length>=7 && byPhone.has(d.phone)) { sameByPhone.push({ d, target: byPhone.get(d.phone) }); continue; }
    uniques.push(d);
  }
  console.log(`  A. same person by email          : ${sameByEmail.length}`);
  console.log(`  A. same person by phone(no email): ${sameByPhone.length}`);
  console.log(`  B. unique — need own contact     : ${uniques.length}`);

  // For each bucket compute donation relinks (only rows I imported: ref LIKE 'partner|%')
  async function importedDonations(partner) {
    return sql`
      SELECT id, contact_id FROM manual_donation
      WHERE location_id = ${LOC} AND import_source = 'claude_code'
        AND reference_number LIKE ${partner + "|%"}
    `;
  }

  let planRelinkSame = 0, planRelinkUnique = 0;
  for (const { d, target } of [...sameByEmail, ...sameByPhone]) {
    const dons = await importedDonations(d.partner);
    planRelinkSame += dons.filter(x => x.contact_id !== target.id).length;
  }
  console.log(`  donations to re-link onto matched contacts (bucket A): ${planRelinkSame}`);
  console.log(`  new contacts to create (bucket B)                     : ${uniques.length}`);

  if (!APPLY) { console.log("\n[dry-run] no writes. --apply to execute."); await sql.end({timeout:5}); process.exit(0); }

  console.log("\n──── APPLY ────");

  // Bucket A: re-link donations to the matched contact; write alias report.
  let relinkedA = 0;
  const aliasReport = [["Partner ID","Matched Contact ID","Matched By","Contact's existing constituents_id"]];
  for (const { d, target } of sameByEmail)  aliasReport.push([d.partner, target.id, "email", target.constituents_id ?? ""]);
  for (const { d, target } of sameByPhone) aliasReport.push([d.partner, target.id, "phone", target.constituents_id ?? ""]);
  for (const { d, target } of [...sameByEmail, ...sameByPhone]) {
    const [{ n }] = await sql`
      WITH u AS (
        UPDATE manual_donation SET contact_id = ${target.id}, updated_at = NOW()
        WHERE location_id = ${LOC} AND import_source = 'claude_code'
          AND reference_number LIKE ${d.partner + "|%"}
          AND contact_id <> ${target.id}
        RETURNING id
      ) SELECT COUNT(*)::int AS n FROM u
    `;
    relinkedA += n;
  }
  console.log(`  A: re-linked ${relinkedA} donations onto matched contacts`);
  const q = v => '"'+String(v??"").replace(/"/g,'""')+'"';
  fs.writeFileSync(`${OUTDIR}/jol-partner-id-aliases.csv`, aliasReport.map(r=>r.map(q).join(",")).join("\n"));
  console.log(`  A: alias map written → ${OUTDIR}/jol-partner-id-aliases.csv`);

  // Bucket B: create contact (unique per new index) + move donations.
  let createdB = 0, relinkedB = 0;
  for (const d of uniques) {
    const addr = [d.addr1, d.city && d.state ? `${d.city}, ${d.state}` : d.city || d.state, d.zip].filter(Boolean).join(", ");
    const first = d.first || d.org || "Unknown";
    const last  = d.last || (d.org ? "" : "Donor") || "Donor";
    let contactId;
    try {
      const [c] = await sql`
        INSERT INTO contact (location_id, first_name, last_name, email, phone, address, constituents_id)
        VALUES (${LOC}, ${first}, ${last}, ${d.rawEmail || null}, ${d.rawPhone || null}, ${addr || null}, ${d.partner})
        RETURNING id
      `;
      contactId = c.id; createdB++;
    } catch (e) {
      // unique-index race / already created — look it up
      const [c] = await sql`SELECT id FROM contact WHERE location_id=${LOC} AND constituents_id=${d.partner} LIMIT 1`;
      if (!c) throw e;
      contactId = c.id;
    }
    const [{ n }] = await sql`
      WITH u AS (
        UPDATE manual_donation SET contact_id = ${contactId}, updated_at = NOW()
        WHERE location_id = ${LOC} AND import_source = 'claude_code'
          AND reference_number LIKE ${d.partner + "|%"}
          AND contact_id <> ${contactId}
        RETURNING id
      ) SELECT COUNT(*)::int AS n FROM u
    `;
    relinkedB += n;
  }
  console.log(`  B: created ${createdB} contacts, re-linked ${relinkedB} donations onto them`);

  // Verify: unlinked partners remaining
  const linkedAfter = new Set((await sql`SELECT constituents_id FROM contact WHERE location_id=${LOC} AND constituents_id IS NOT NULL`).map(r=>r.constituents_id));
  const remaining = [...donors.keys()].filter(p => !linkedAfter.has(p));
  console.log(`\nVerify — CSV Partner IDs still without their own contact: ${remaining.length}`);
  console.log(`  (bucket-A aliases are intentionally not separate contacts — same person)`);
  const [{ tot }] = await sql`SELECT COUNT(*)::int AS tot FROM contact WHERE location_id=${LOC}`;
  console.log(`  JOL contact count now: ${tot}`);
} finally { await sql.end({timeout:5}); }
