// Run: npx tsx --test lib/accounting/schemas.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { ACCRUAL_MESSAGE, SettingsBody } from "./schemas.ts";

const ok = { system: "quickbooks_online", basis: "cash", startDate: "2026-11-01", unmappedAccountId: 5, entryType: "deposit", autoSyncEnabled: false };

test("a normal cash-basis save is accepted, with or without a start date", () => {
  assert.equal(SettingsBody.safeParse(ok).success, true);
  assert.equal(SettingsBody.safeParse({ ...ok, startDate: null, unmappedAccountId: null }).success, true);
});

test("accrual basis is refused with a plain message", () => {
  const r = SettingsBody.safeParse({ ...ok, basis: "accrual" });
  assert.equal(r.success, false);
  assert.equal(r.success ? "" : r.error.issues[0].message, ACCRUAL_MESSAGE);
});

test("other invalid values are still refused", () => {
  for (const bad of [{ basis: "weekly" }, { startDate: "2026-13-45" }, { entryType: "check" }, { system: "xero" }, { unmappedAccountId: 0 }]) {
    assert.equal(SettingsBody.safeParse({ ...ok, ...bad }).success, false, JSON.stringify(bad));
  }
});
