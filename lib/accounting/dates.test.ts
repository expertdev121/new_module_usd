// Run: node --test lib/accounting/dates.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { isRealDate } from "./dates.ts";

test("accepts real dates, including leap day", () => {
  for (const d of ["2026-10-26", "2024-02-29", "2026-12-31", "2026-01-01"]) assert.equal(isRealDate(d), true, d);
});

test("rejects impossible dates and wrong shapes", () => {
  for (const d of ["2026-13-45", "2026-02-31", "2025-02-29", "2026-00-10", "2026-10-00", "2026-4-5", "10/26/2026", "", "2026-10-26T00:00", "abcd-ef-gh", "0001-01-01", "9999-12-31"]) {
    assert.equal(isRealDate(d), false, d);
  }
});
