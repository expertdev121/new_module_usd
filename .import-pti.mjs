/**
 * PTI import — households + contacts + manual_donation.
 *
 * Idempotent (safe to re-run):
 *   - household        dedup by (location_id, external_id) = PTI accounts.id
 *   - contact          dedup by (location_id, constituents_id) = PTI people.id
 *   - manual_donation  dedup by (location_id, reference_number) = PTI Internal ID
 *
 * Rules:
 *   - Only Payment>0 rows (skip Charge / billing rows; else double count)
 *   - Skip future-dated (>2026-08-05) so we import history, not projections
 *   - Payment status: 'refunded' if Type has Reversal / Refund; else 'completed'
 *   - payment_method: normalized string ('credit_card','ach','check','paypal','other')
 *   - Fund names ("Building Fund", "Matanos LeEvyonim") land in notes
 *   - Currency: USD
 *   - Contacts with account_id=0 skipped (orphans)
 *   - manual_donation.contactId REQUIRED — resolved to the household's primary
 *     contact. Household stays on household_id column for family-level view.
 *   - import_source = 'claude_code' on every row inserted here (audit trail).
 *
 * Dry-run by default. Pass --apply to insert.
 */
import fs from "node:fs";
import postgres from "postgres";
import XLSX from "xlsx";

const APPLY = process.argv.includes("--apply");
const LOC = "92T9l8F6sMASmiOWLMP5";
const IMPORT_SOURCE = "claude_code";
const PEOPLE_CSV = "/Users/nikhil/Downloads/PTI_people_20260727.csv";
const TX_CSV     = "/Users/nikhil/Downloads/PTI_transactionsexport_20260727.csv";
const ACC_XLSX   = "/Users/nikhil/Downloads/PTI_accounts_20260727.xlsx";
const TODAY = "2026-08-05";

const url = fs.readFileSync(".env","utf8").split("\n")
  .find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g,"");
const sql = postgres(url,{ssl:"require",max:1});

function parseCSV(s){
  const out=[]; let row=[],cur="",q=false;
  for (let i=0;i<s.length;i++){const c=s[i];
    if (q){if(c==='"'){if(s[i+1]==='"'){cur+='"';i++;}else q=false;}else cur+=c;}
    else {if(c==='"')q=true;
      else if(c===','){row.push(cur);cur="";}
      else if(c==='\n'){row.push(cur);out.push(row);row=[];cur="";}
      else if(c!=='\r')cur+=c;}
  }
  if (cur.length||row.length){row.push(cur);out.push(row);}
  return out;
}
function loadCSV(p){
  let raw=fs.readFileSync(p,"utf8");
  if (raw.charCodeAt(0)===0xFEFF) raw=raw.slice(1);
  const rows = parseCSV(raw);
  return { h:rows[0], d:rows.slice(1).filter(r=>r.length>1),
           g:(r,n)=>r[rows[0].indexOf(n)] ?? "" };
}
function loadXLSX(p){
  const wb = XLSX.readFile(p);
  const csv = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
  const rows = parseCSV(csv);
  return { h:rows[0], d:rows.slice(1).filter(r=>r.length>1),
           g:(r,n)=>r[rows[0].indexOf(n)] ?? "" };
}

console.log("Loading source files…");
const A = loadXLSX(ACC_XLSX);
const P = loadCSV(PEOPLE_CSV);
const T = loadCSV(TX_CSV);
console.log(`  accounts: ${A.d.length}`);
console.log(`  people:   ${P.d.length}`);
console.log(`  tx:       ${T.d.length}`);

function normDate(s){
  if (!s || s === "-" || s === "0000-00-00") return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m){let [_,mo,d,y]=m; if(y.length===2) y=(parseInt(y,10)>50?"19":"20")+y;
    return `${y}-${mo.padStart(2,"0")}-${d.padStart(2,"0")}`;}
  return null;
}
function mapMethod(type){
  const t=(type||"").toLowerCase();
  if (t.includes("credit")||t.includes("card")) return "credit_card";
  if (t.includes("ach")) return "ach";
  if (t.includes("check")) return "check";
  if (t.includes("paypal")) return "paypal";
  if (t.includes("cash")) return "cash";
  return "other";
}
function normStatus(row){
  const rev = T.g(row,"Reversal Type");
  const notes = T.g(row,"Notes") || "";
  if (rev || /refund|revers/i.test(notes)) return "refunded";
  return "completed";
}
function cleanStr(s){ const v=(s||"").trim(); return v==="-"?null:(v||null); }

// Plan
const householdPlan = [];
for (const r of A.d){
  const ext = A.g(r,"id");
  if (!ext) continue;
  householdPlan.push({
    external_id: ext,
    display_name: A.g(r,"Last Name First") || A.g(r,"Mail Label") || `Household ${ext}`,
    membership_tier: cleanStr(A.g(r,"Account Type")),
    mail_label: cleanStr(A.g(r,"Mail Label")),
    mail_address1: cleanStr(A.g(r,"Street Address")),
    mail_address2: cleanStr(A.g(r,"Address 2")),
    mail_city: cleanStr(A.g(r,"City")),
    mail_state: cleanStr(A.g(r,"State")),
    mail_zip: cleanStr(A.g(r,"Postal Code")),
    mail_country: cleanStr(A.g(r,"Country")),
    household_phone: cleanStr(A.g(r,"Phone")),
    household_email: cleanStr(A.g(r,"Email")),
    date_joined: normDate(A.g(r,"Date Joined SC")),
    total_balance: parseFloat(A.g(r,"Total Balance")||"0") || 0,
  });
}

const contactPlan = [];
let skippedOrphans = 0;
for (const r of P.d){
  const aid = P.g(r,"account_id");
  if (!aid || aid==="0"){ skippedOrphans++; continue; }
  const isPrimary = P.g(r,"is_primary_contact") === "Y";
  contactPlan.push({
    external_id: P.g(r,"id"),
    account_ext_id: aid,
    first_name: cleanStr(P.g(r,"first_name")) || "Unknown",
    last_name:  cleanStr(P.g(r,"last_name"))  || "Household",
    display_name: cleanStr(P.g(r,"mail_name")),
    email: cleanStr(P.g(r,"email")),
    phone: cleanStr(P.g(r,"mobile")) || cleanStr(P.g(r,"phone1")),
    address: [P.g(r,"address1"), P.g(r,"city"), P.g(r,"state")].filter(Boolean).join(", ") || null,
    is_primary_contact: isPrimary,
    relationship: isPrimary ? "primary" : "family",
  });
}

const paymentPlan = [];
let skippedCharges=0, skippedFuture=0, skippedNoAcct=0;
for (const r of T.d){
  const pay = parseFloat(T.g(r,"Payment")||"0") || 0;
  if (pay<=0){ skippedCharges++; continue; }
  const dt = normDate(T.g(r,"Date"));
  if (!dt) continue;
  if (dt > TODAY){ skippedFuture++; continue; }
  const acctExt = T.g(r,"Account ID");
  if (!acctExt){ skippedNoAcct++; continue; }
  const type = T.g(r,"Type") || "";
  const ded = cleanStr(T.g(r,"Dedication Notes"));
  const notes = cleanStr(T.g(r,"Notes"));
  const combined = [notes, ded ? `Dedication: ${ded}` : null, `PTI Type: ${type}`].filter(Boolean).join(" | ");
  paymentPlan.push({
    reference_number: T.g(r,"Internal ID") || `PTI-${T.g(r,"ID")}-${dt}`,
    account_ext_id: acctExt,
    amount: pay.toFixed(2),
    currency: "USD",
    payment_date: dt,
    payment_method: mapMethod(type),
    payment_status: normStatus(r),
    notes: combined,
  });
}

const totalPayment = paymentPlan.reduce((s,p)=>s+parseFloat(p.amount),0);
console.log("\n────────── PLAN ──────────");
console.log(`Households      : ${householdPlan.length}`);
console.log(`Contacts        : ${contactPlan.length}   (${skippedOrphans} orphans skipped)`);
console.log(`Manual donations: ${paymentPlan.length}  ($${totalPayment.toFixed(2)})`);
console.log(`   skipped: ${skippedCharges} charge-only, ${skippedFuture} future, ${skippedNoAcct} no-account`);
if (!APPLY){
  console.log("\n[dry-run] no changes. Re-run with --apply.");
  await sql.end({timeout:5});
  process.exit(0);
}

console.log("\n────────── APPLY ──────────");

// Households
const existingHH = await sql`SELECT id, external_id FROM household WHERE location_id=${LOC}`;
const extToHhId = new Map(existingHH.map(r=>[r.external_id, r.id]));
console.log(`  household: ${existingHH.length} already present`);
let hhCreated=0;
const HH_BATCH=500;
for (let i=0;i<householdPlan.length;i+=HH_BATCH){
  const batch = householdPlan.slice(i,i+HH_BATCH).filter(h=>!extToHhId.has(h.external_id));
  if (!batch.length) continue;
  const rows = await sql`
    INSERT INTO household ${sql(batch.map(h=>({
      location_id:LOC, external_id:h.external_id, display_name:h.display_name,
      membership_tier:h.membership_tier, mail_label:h.mail_label,
      mail_address1:h.mail_address1, mail_address2:h.mail_address2,
      mail_city:h.mail_city, mail_state:h.mail_state, mail_zip:h.mail_zip, mail_country:h.mail_country,
      household_phone:h.household_phone, household_email:h.household_email,
      date_joined:h.date_joined, total_balance:h.total_balance,
    })))} RETURNING id, external_id`;
  for (const r of rows){ extToHhId.set(r.external_id, r.id); hhCreated++; }
  process.stdout.write(`\r  household: created ${hhCreated}…`);
}
console.log(`\n  ✅ household: ${hhCreated} created, ${extToHhId.size} total`);

// Contacts
const existingContacts = await sql`
  SELECT id, constituents_id FROM contact WHERE location_id=${LOC} AND constituents_id IS NOT NULL
`;
const extToCid = new Map(existingContacts.map(r=>[r.constituents_id, r.id]));
// Also need to know which of those is primary for each household
// We insert contacts and remember mapping account_ext_id → primary_contact_id
const acctToPrimaryContactId = new Map();
console.log(`  contact: ${existingContacts.length} already present with PTI id`);
let cCreated=0;
const C_BATCH=500;
for (let i=0;i<contactPlan.length;i+=C_BATCH){
  const batch = contactPlan.slice(i,i+C_BATCH).filter(c=>!extToCid.has(c.external_id));
  if (!batch.length){
    // still capture existing primaries
    for (const c of contactPlan.slice(i,i+C_BATCH)){
      if (c.is_primary_contact){
        const cid = extToCid.get(c.external_id);
        if (cid) acctToPrimaryContactId.set(c.account_ext_id, cid);
      }
    }
    continue;
  }
  const rows = await sql`
    INSERT INTO contact ${sql(batch.map(c=>({
      location_id:LOC, constituents_id:c.external_id,
      first_name:c.first_name, last_name:c.last_name, display_name:c.display_name,
      email:c.email, phone:c.phone, address:c.address,
      household_id: extToHhId.get(c.account_ext_id) ?? null,
      is_primary_contact: c.is_primary_contact, relationship: c.relationship,
    })))} RETURNING id, constituents_id`;
  const idByExt = new Map(rows.map(r=>[r.constituents_id, r.id]));
  for (const c of batch){
    const cid = idByExt.get(c.external_id);
    if (cid){
      extToCid.set(c.external_id, cid); cCreated++;
      if (c.is_primary_contact) acctToPrimaryContactId.set(c.account_ext_id, cid);
    }
  }
  process.stdout.write(`\r  contact: created ${cCreated}…`);
}
console.log(`\n  ✅ contact: ${cCreated} created, ${extToCid.size} total`);

// Backfill primaries that were already in DB
if (acctToPrimaryContactId.size < extToHhId.size){
  const primaries = await sql`
    SELECT c.id AS contact_id, c.household_id, h.external_id
    FROM contact c JOIN household h ON c.household_id = h.id
    WHERE h.location_id=${LOC} AND c.is_primary_contact=TRUE
  `;
  for (const p of primaries){
    if (!acctToPrimaryContactId.has(p.external_id)){
      acctToPrimaryContactId.set(p.external_id, p.contact_id);
    }
  }
}
// Fallback: for households with no primary, pick ANY member so contactId is satisfied
const fallbackNeeded = [...extToHhId.keys()].filter(k=>!acctToPrimaryContactId.has(k));
if (fallbackNeeded.length){
  const anyMembers = await sql`
    SELECT DISTINCT ON (h.external_id) h.external_id, c.id AS contact_id
    FROM contact c JOIN household h ON c.household_id = h.id
    WHERE h.location_id=${LOC}
    ORDER BY h.external_id, c.id
  `;
  for (const m of anyMembers){
    if (!acctToPrimaryContactId.has(m.external_id)){
      acctToPrimaryContactId.set(m.external_id, m.contact_id);
    }
  }
}
console.log(`  primaries resolved: ${acctToPrimaryContactId.size}/${extToHhId.size}`);

// Manual donations
const existingPay = await sql`
  SELECT reference_number FROM manual_donation
  WHERE location_id=${LOC} AND reference_number IS NOT NULL
`;
const seenRefs = new Set(existingPay.map(r=>r.reference_number));
console.log(`  manual_donation: ${seenRefs.size} already present with PTI ref`);
let pCreated=0, pSkippedNoContact=0;
const P_BATCH=500;
for (let i=0;i<paymentPlan.length;i+=P_BATCH){
  const batch = paymentPlan.slice(i,i+P_BATCH).filter(p=>!seenRefs.has(p.reference_number));
  if (!batch.length) continue;
  const inserts = [];
  for (const p of batch){
    const contactId = acctToPrimaryContactId.get(p.account_ext_id);
    const householdId = extToHhId.get(p.account_ext_id);
    if (!contactId || !householdId){ pSkippedNoContact++; continue; }
    inserts.push({
      contact_id: contactId,
      household_id: householdId,
      amount: p.amount,
      currency: p.currency,
      amount_usd: p.amount,
      exchange_rate: "1.0000",
      payment_date: p.payment_date,
      received_date: p.payment_date,
      payment_method: p.payment_method,
      payment_status: p.payment_status,
      reference_number: p.reference_number,
      notes: p.notes,
      location_id: LOC,
      import_source: IMPORT_SOURCE,
      receipt_issued: false,
    });
  }
  if (!inserts.length) continue;
  const rows = await sql`
    INSERT INTO manual_donation ${sql(inserts)} RETURNING id, reference_number
  `;
  for (const r of rows){ seenRefs.add(r.reference_number); pCreated++; }
  process.stdout.write(`\r  manual_donation: created ${pCreated}…`);
}
console.log(`\n  ✅ manual_donation: ${pCreated} created (${pSkippedNoContact} skipped: household had no contact)`);

// Verify
const [{ sum, cnt }] = await sql`
  SELECT COALESCE(SUM(amount),0) AS sum, COUNT(*) AS cnt
  FROM manual_donation WHERE location_id=${LOC} AND import_source=${IMPORT_SOURCE}
`;
console.log(`\nTotal in manual_donation for PTI (import_source=claude_code): $${parseFloat(sum).toFixed(2)} across ${cnt} rows.`);

await sql.end({timeout:5});
console.log("\nDone.");
