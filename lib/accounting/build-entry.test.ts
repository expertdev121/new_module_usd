// Run: node --test lib/accounting/build-entry.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildEntry, checkBankAmount, fromCents, toCents, type EntryGift } from "./build-entry.ts";

const gift = (id: number, campaignId: number | null, amount: string, name = `Fund ${campaignId}`): EntryGift => ({
  id,
  campaignId,
  campaignName: campaignId === null ? null : name,
  amountCents: toCents(amount),
});

const maps = new Map([
  [1, { incomeAccountId: 40, dimensionId: 7 }],
  [2, { incomeAccountId: 41, dimensionId: null }],
  [3, { incomeAccountId: null, dimensionId: null }],
]);

test("money helpers survive float noise", () => {
  assert.equal(toCents("0.1") + toCents("0.2"), 30);
  assert.equal(toCents("19.99"), 1999);
  assert.equal(fromCents(1999), "19.99");
  assert.equal(fromCents(5), "0.05");
});

test("25 checks across 4 funds: one entry, 4 income lines, bank debit equals deposit", () => {
  const gifts: EntryGift[] = [];
  const fourMaps = new Map([1, 2, 4, 5].map((c, i) => [c, { incomeAccountId: 40 + i, dimensionId: null }]));
  const ids = [1, 2, 4, 5];
  for (let i = 0; i < 25; i++) gifts.push(gift(i + 1, ids[i % 4], (10 + i * 3.37).toFixed(2)));
  const e = buildEntry({ gifts, fundMap: fourMaps, depositAccountId: 10, catchAllAccountId: 99, sourceLabel: "Check" });
  const credit = e.lines.filter((l) => l.creditCents > 0);
  const debit = e.lines.filter((l) => l.debitCents > 0);
  assert.equal(credit.length, 4);
  assert.equal(debit.length, 1);
  assert.equal(debit[0].accountId, 10);
  assert.equal(debit[0].debitCents, gifts.reduce((s, g) => s + g.amountCents, 0));
  assert.deepEqual(e.blockers, []);
  assert.equal(e.unmappedCampaigns.length, 0);
});

test("fund mapping carries account and class", () => {
  const e = buildEntry({ gifts: [gift(1, 1, "100.00")], fundMap: maps, depositAccountId: 10, catchAllAccountId: null, sourceLabel: "Cash" });
  const line = e.lines.find((l) => l.creditCents > 0)!;
  assert.equal(line.accountId, 40);
  assert.equal(line.dimensionId, 7);
  assert.equal(line.unmapped, false);
});

test("unmapped fund goes to the catch-all and is flagged", () => {
  const e = buildEntry({ gifts: [gift(1, 3, "50.00"), gift(2, 1, "25.00")], fundMap: maps, depositAccountId: 10, catchAllAccountId: 99, sourceLabel: "Check" });
  const flagged = e.lines.find((l) => l.unmapped)!;
  assert.equal(flagged.accountId, 99);
  assert.match(flagged.memo, /UNMAPPED/);
  assert.deepEqual(e.unmappedCampaigns.map((u) => u.campaignId), [3]);
  assert.deepEqual(e.blockers, []);
});

test("gift with no campaign is unmapped; no catch-all blocks closing", () => {
  const e = buildEntry({ gifts: [gift(1, null, "20.00")], fundMap: maps, depositAccountId: 10, catchAllAccountId: null, sourceLabel: "Check" });
  assert.equal(e.unmappedCampaigns.length, 1);
  assert.ok(e.blockers.some((b) => b.includes("catch-all")));
});

test("missing deposit account and empty deposit are blockers", () => {
  const a = buildEntry({ gifts: [gift(1, 1, "5.00")], fundMap: maps, depositAccountId: null, catchAllAccountId: 99, sourceLabel: "ACH" });
  assert.ok(a.blockers.some((b) => b.includes("deposit account")));
  const b = buildEntry({ gifts: [], fundMap: maps, depositAccountId: 10, catchAllAccountId: 99, sourceLabel: "ACH" });
  assert.ok(b.blockers.some((x) => x.includes("no gifts")));
});

test("debits always equal credits", () => {
  const gifts = Array.from({ length: 40 }, (_, i) => gift(i + 1, (i % 3) + 1, (0.01 + i * 1.11).toFixed(2)));
  const e = buildEntry({ gifts, fundMap: maps, depositAccountId: 10, catchAllAccountId: 99, sourceLabel: "Check" });
  const d = e.lines.reduce((s, l) => s + l.debitCents, 0);
  const c = e.lines.reduce((s, l) => s + l.creditCents, 0);
  assert.equal(d, c);
  assert.equal(d, e.grossCents);
});

test("card payout: bank is debited net of the fee, fee goes to the fee account, entry balances", () => {
  const e = buildEntry({ gifts: [gift(1, 1, "700.00"), gift(2, 2, "300.00")], fundMap: maps, depositAccountId: 10, catchAllAccountId: null, sourceLabel: "Card", feesCents: toCents("30.00"), feeAccountId: 55 });
  assert.deepEqual(e.blockers, []);
  const debits = e.lines.filter((l) => l.debitCents > 0);
  assert.equal(debits.length, 2);
  // The bank line stays first: QuickBooks takes the first debit as the deposit account.
  assert.equal(debits[0].accountId, 10);
  assert.equal(debits[0].debitCents, toCents("970.00"));
  assert.equal(debits[1].accountId, 55);
  assert.equal(debits[1].debitCents, toCents("30.00"));
  assert.equal(e.grossCents, toCents("1000.00"));
  assert.equal(e.netCents, toCents("970.00"));
  assert.equal(e.lines.reduce((s, l) => s + l.debitCents, 0), e.lines.reduce((s, l) => s + l.creditCents, 0));
});

test("fee without a fee account blocks closing", () => {
  const e = buildEntry({ gifts: [gift(1, 1, "100.00")], fundMap: maps, depositAccountId: 10, catchAllAccountId: null, sourceLabel: "Card", feesCents: 300, feeAccountId: null });
  assert.match(e.blockers.join(" "), /No fee account/);
});

test("a fee as large as the gifts is refused", () => {
  const e = buildEntry({ gifts: [gift(1, 1, "10.00")], fundMap: maps, depositAccountId: 10, catchAllAccountId: null, sourceLabel: "Card", feesCents: 1000, feeAccountId: 55 });
  assert.match(e.blockers.join(" "), /smaller than the gifts/);
});

test("no fee: same single bank line as a check deposit", () => {
  const e = buildEntry({ gifts: [gift(1, 1, "100.00")], fundMap: maps, depositAccountId: 10, catchAllAccountId: null, sourceLabel: "Card", feesCents: 0, feeAccountId: null });
  assert.equal(e.lines.filter((l) => l.debitCents > 0).length, 1);
  assert.equal(e.netCents, e.grossCents);
});

test("bank amount check: matches gifts minus fee, otherwise says by how much", () => {
  assert.equal(checkBankAmount(100000, 3000, 97000), null);
  assert.match(checkBankAmount(100000, 3000, 100000)!, /does not match.*970\.00/);
  assert.match(checkBankAmount(100000, 0, 99999)!, /does not match/);
});
