// Run: node --test lib/accounting/normalize-payment-method.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { normalizePaymentMethod } from "./normalize-payment-method.ts";

test("card spellings collapse to card", () => {
  for (const v of ["card", "credit card", "credit_card", "Credit Card", "  CARD ", "debit card", "stripe", "gateway"]) {
    assert.equal(normalizePaymentMethod(v), "card", v);
  }
});

test("check and cheque are both check", () => {
  for (const v of ["check", "cheque", "Check", "money_order"]) {
    assert.equal(normalizePaymentMethod(v), "check", v);
  }
});

test("cash, ach, paypal, bank transfer", () => {
  assert.equal(normalizePaymentMethod("cash"), "cash");
  assert.equal(normalizePaymentMethod("ach"), "ach");
  assert.equal(normalizePaymentMethod("ach-stripe"), "ach");
  assert.equal(normalizePaymentMethod("paypal"), "paypal");
  assert.equal(normalizePaymentMethod("wire"), "bank_transfer");
  assert.equal(normalizePaymentMethod("xfer"), "bank_transfer");
});

test("unknown, empty and null fall back to other", () => {
  for (const v of [null, undefined, "", "   ", "other", "sales receipt", "scholarship", "something new"]) {
    assert.equal(normalizePaymentMethod(v as string | null | undefined), "other", String(v));
  }
});
