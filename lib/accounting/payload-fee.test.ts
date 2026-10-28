// Run: node --test lib/accounting/payload-fee.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildQboPayload } from "./qbo/payload.ts";
import { isFeeSource, MANUAL_SOURCES } from "./normalize-payment-method.ts";

const lines = [
  { accountExternalId: "40", classExternalId: "7", debitCents: 0, creditCents: 70000, memo: "General · 3 gifts" },
  { accountExternalId: "41", classExternalId: null, debitCents: 0, creditCents: 30000, memo: "Building · 1 gift" },
  { accountExternalId: "10", classExternalId: null, debitCents: 97000, creditCents: 0, memo: "Deposit · Card" },
  { accountExternalId: "55", classExternalId: null, debitCents: 3000, creditCents: 0, memo: "Processing fees · Card" },
];

test("QuickBooks Deposit: bank is the deposit account, fee is a negative line, lines sum to the bank amount", () => {
  const p = buildQboPayload("Deposit", { id: 9, depositDate: "2026-11-02", reference: null, lines });
  const body = p.body as { DepositToAccountRef: { value: string }; Line: Array<{ Amount: number; DepositLineDetail: { AccountRef: { value: string } } }> };
  assert.equal(body.DepositToAccountRef.value, "10");
  const fee = body.Line.find((l) => l.DepositLineDetail.AccountRef.value === "55")!;
  assert.equal(fee.Amount, -30);
  assert.equal(body.Line.reduce((s, l) => s + l.Amount, 0), 970);
});

test("QuickBooks Journal Entry carries the fee as an ordinary debit", () => {
  const p = buildQboPayload("JournalEntry", { id: 9, depositDate: "2026-11-02", reference: null, lines });
  const jl = (p.body as { Line: Array<{ Amount: number; JournalEntryLineDetail: { PostingType: string; AccountRef: { value: string } } }> }).Line;
  const fee = jl.find((l) => l.JournalEntryLineDetail.AccountRef.value === "55")!;
  assert.equal(fee.JournalEntryLineDetail.PostingType, "Debit");
  assert.equal(fee.Amount, 30);
});

test("card and PayPal take fees; check does not; both can be grouped into deposits", () => {
  assert.equal(isFeeSource("card"), true);
  assert.equal(isFeeSource("paypal"), true);
  assert.equal(isFeeSource("check"), false);
  assert.ok((MANUAL_SOURCES as readonly string[]).includes("card") && (MANUAL_SOURCES as readonly string[]).includes("paypal"));
});
