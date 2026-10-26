/**
 * Seeds two TEST orgs for the DonorHQ accounting-sync pilot (see
 * "DonorHQ Accounting Build Plan"). Mirrors the messy real data found in the
 * spike: mixed payment-method spellings, checks with/without numbers, cash,
 * card/Stripe, refunds, and one org keyed on campaign, one on category.
 *
 * SAFETY: runs ONLY against SEED_DATABASE_URL (a Neon branch). It refuses to run
 * if that URL points at the same database as DATABASE_URL (production).
 * Every row is tagged import_source = 'accounting_test_seed' and the two
 * location ids are fixed, so re-running wipes and recreates only test rows.
 *
 * Usage:
 *   SEED_DATABASE_URL=postgres://...branch... node scripts/seed-accounting-test-orgs.mjs
 *   (add --dry-run to print the plan without connecting)
 */
import "dotenv/config";
import postgres from "postgres";

const TAG = "accounting_test_seed";
const ORGS = {
  campaign: { locationId: "TEST_ACCT_CAMPAIGN", name: "Test Synagogue (fund = campaign)" },
  category: { locationId: "TEST_ACCT_CATEGORY", name: "Test Camp Org (fund = category)" },
};

const dryRun = process.argv.includes("--dry-run");
const seedUrl = process.env.SEED_DATABASE_URL;

const dbKey = (u) => {
  try {
    const x = new URL(u);
    return `${x.hostname.replace(/-pooler/, "")}${x.pathname}`;
  } catch {
    return u;
  }
};

if (!dryRun) {
  if (!seedUrl) {
    console.error("SEED_DATABASE_URL is not set. Create a Neon branch and pass its connection string.");
    process.exit(1);
  }
  if (process.env.DATABASE_URL && dbKey(seedUrl) === dbKey(process.env.DATABASE_URL)) {
    console.error("Refusing to run: SEED_DATABASE_URL points at the same database as DATABASE_URL.");
    process.exit(1);
  }
}

// ---- deterministic pseudo-random so reruns produce the same data ----
let s = 42;
const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const amt = (lo, hi) => (Math.round((lo + rnd() * (hi - lo)) * 100) / 100).toFixed(2);
const day = (offset) => {
  const d = new Date(Date.UTC(2026, 8, 1 + offset));
  return d.toISOString().slice(0, 10);
};

const FIRST = ["Avi", "Miriam", "Daniel", "Sarah", "Moshe", "Rivka", "David", "Leah", "Yosef", "Hannah", "Ben", "Esther"];
const LAST = ["Cohen", "Levi", "Katz", "Friedman", "Goldberg", "Klein", "Rosen", "Shapiro", "Weiss", "Stern"];

const CHECK_SPELL = ["check", "check", "check", "cheque"];
const CARD_SPELL = ["card", "credit card", "credit_card"];

// gift templates per org: [fundName, ...]
const CAMPAIGN_FUNDS = ["General Fund", "Building Fund", "High Holiday Appeal", "Kiddush Sponsorship", "Scholarship Fund"];
const CATEGORY_FUNDS = ["Camp Scholarships", "Youth Programs", "Annual Dinner", "Alumni & Friends"];

function buildGifts(kind, contactIds) {
  const funds = kind === "campaign" ? CAMPAIGN_FUNDS : CATEGORY_FUNDS;
  const gifts = [];
  const add = (g) => gifts.push({ contact: pick(contactIds), ...g });

  // 25 checks, 4 funds, one deposit-sized stack on one day (plan scenario 1)
  for (let i = 0; i < 25; i++) {
    add({ fund: funds[i % 4], method: pick(CHECK_SPELL), amount: amt(18, 1800), date: day(3), checkNo: i % 3 === 0 ? null : String(5000 + i), status: "completed" });
  }
  // cash stack
  for (let i = 0; i < 8; i++) add({ fund: funds[i % funds.length], method: "cash", amount: amt(10, 250), date: day(5), status: "completed" });
  // card / stripe-style online gifts over three weeks
  for (let i = 0; i < 30; i++) {
    add({ fund: pick(funds), method: pick(CARD_SPELL), amount: amt(5, 500), date: day(2 + (i % 21)), ref: `pi_TEST${kind}${String(i).padStart(3, "0")}`, status: "completed" });
  }
  // ACH + PayPal + null-method rows
  for (let i = 0; i < 4; i++) add({ fund: pick(funds), method: "ach", amount: amt(100, 900), date: day(10 + i), status: "completed" });
  add({ fund: pick(funds), method: "paypal", amount: amt(20, 200), date: day(12), status: "completed" });
  add({ fund: pick(funds), method: null, amount: amt(20, 200), date: day(13), status: "completed" });
  // refunds (plan scenario 2): card gifts later marked refunded
  for (let i = 0; i < 3; i++) add({ fund: pick(funds), method: "credit card", amount: amt(25, 300), date: day(8 + i), ref: `pi_TEST${kind}REF${i}`, status: "refunded" });
  // failed / pending noise
  add({ fund: pick(funds), method: "card", amount: amt(25, 100), date: day(15), status: "failed" });
  add({ fund: pick(funds), method: "card", amount: amt(25, 100), date: day(16), status: "pending" });
  // gift with NO fund (plan scenario: unmapped fund -> catch-all)
  for (let i = 0; i < 3; i++) add({ fund: null, method: pick(CARD_SPELL), amount: amt(10, 120), date: day(18 + i), status: "completed" });
  return gifts;
}

if (dryRun) {
  for (const kind of Object.keys(ORGS)) {
    const g = buildGifts(kind, [1, 2, 3]);
    const by = (f) => g.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
    console.log(`\n[dry-run] ${ORGS[kind].name} (${ORGS[kind].locationId}): ${g.length} gifts`);
    console.log(" methods:", by((x) => x.method ?? "(null)"));
    console.log(" funds:  ", by((x) => x.fund ?? "(none)"));
    console.log(" status: ", by((x) => x.status));
  }
  process.exit(0);
}

const sql = postgres(seedUrl, { ssl: "require", max: 1, connect_timeout: 20 });

try {
  await sql.begin(async (tx) => {
    for (const [kind, org] of Object.entries(ORGS)) {
      const loc = org.locationId;
      // wipe previous test rows for this fake location only
      await tx`delete from manual_donation where location_id = ${loc} and import_source = ${TAG}`;
      await tx`delete from contact where location_id = ${loc}`;
      await tx`delete from campaign where location_id = ${loc}`;
      await tx`delete from category where location_id = ${loc}`;

      const contactIds = [];
      for (let i = 0; i < 12; i++) {
        const [c] = await tx`
          insert into contact (first_name, last_name, email, location_id)
          values (${FIRST[i]}, ${pick(LAST)}, ${`test.donor${i}+${kind}@example.invalid`}, ${loc})
          returning id`;
        contactIds.push(c.id);
      }

      const fundIds = {};
      const funds = kind === "campaign" ? CAMPAIGN_FUNDS : CATEGORY_FUNDS;
      for (const f of funds) {
        if (kind === "campaign") {
          const [r] = await tx`insert into campaign (name, status, location_id) values (${f}, 'active', ${loc}) returning id`;
          fundIds[f] = r.id;
        } else {
          const [r] = await tx`insert into category (name, location_id, is_active) values (${f}, ${loc}, true) returning id`;
          fundIds[f] = r.id;
        }
      }

      const gifts = buildGifts(kind, contactIds);
      for (const g of gifts) {
        const campaignId = kind === "campaign" && g.fund ? fundIds[g.fund] : null;
        const categoryId = kind === "category" && g.fund ? fundIds[g.fund] : null;
        await tx`
          insert into manual_donation
            (contact_id, category_id, campaign_id, amount, currency, payment_date, payment_method,
             payment_status, reference_number, check_number, location_id, import_source)
          values
            (${g.contact}, ${categoryId}, ${campaignId}, ${g.amount}, 'USD', ${g.date}, ${g.method},
             ${g.status}, ${g.ref ?? null}, ${g.checkNo ?? null}, ${loc}, ${TAG})`;
      }
      console.log(`Seeded ${org.name}: ${contactIds.length} contacts, ${funds.length} funds, ${gifts.length} gifts`);
    }
  });
} finally {
  await sql.end();
}
