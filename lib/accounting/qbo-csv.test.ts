// Run: node --test lib/accounting/qbo-csv.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { buildQboJournalCsv, csvField, safeText, usDate, type ExportDeposit } from "./qbo-csv.ts";

const dep = (over: Partial<ExportDeposit> = {}): ExportDeposit => ({
  id: 7,
  depositDate: "2026-09-04",
  reference: "SLIP-1",
  lines: [
    { accountName: "General Contributions", className: "Unrestricted", debit: "0.00", credit: "100.50", memo: "General Fund · 2 gifts" },
    { accountName: "Building Fund Income", className: null, debit: "0.00", credit: "49.50", memo: "Building Fund · 1 gift" },
    { accountName: "Operating Checking", className: null, debit: "150.00", credit: "0.00", memo: "Deposit · Check · 3 gifts" },
  ],
  ...over,
});

test("header, one journal number per deposit, US dates, blank zero columns", () => {
  const { csv, rows, problems } = buildQboJournalCsv([dep(), dep({ id: 8, reference: null })]);
  const lines = csv.trim().split("\r\n");
  assert.equal(lines[0], "*JournalNo,*JournalDate,*AccountName,*Debits,*Credits,Description,Name,Currency,Location,Class");
  assert.equal(lines.length, 1 + 6);
  assert.deepEqual(problems, []);
  assert.deepEqual([...new Set(rows.map((r) => r.journalNo))], ["DHQ-7", "DHQ-8"]);
  assert.ok(lines[1].startsWith("DHQ-7,09/04/2026,General Contributions,,100.50,"));
  assert.ok(lines[3].startsWith("DHQ-7,09/04/2026,Operating Checking,150.00,,"));
  assert.ok(lines[1].endsWith(",,,,Unrestricted"));
});

test("description carries memo, deposit id and bank reference", () => {
  const { rows } = buildQboJournalCsv([dep()]);
  assert.equal(rows[0].description, "General Fund · 2 gifts | DonorHQ deposit #7 | Ref SLIP-1");
  assert.equal(buildQboJournalCsv([dep({ reference: null })]).rows[0].description, "General Fund · 2 gifts | DonorHQ deposit #7");
});

test("debits equal credits across the file", () => {
  const { rows } = buildQboJournalCsv([dep(), dep({ id: 9 })]);
  const sum = (k: "debit" | "credit") => rows.reduce((s, r) => s + Math.round(Number(r[k] || 0) * 100), 0);
  assert.equal(sum("debit"), sum("credit"));
});

test("fields with commas and quotes are quoted", () => {
  assert.equal(csvField("Kiddush, Sponsorship"), '"Kiddush, Sponsorship"');
  assert.equal(csvField('Say "hi"'), '"Say ""hi"""');
  assert.equal(csvField("plain"), "plain");
});

test("spreadsheet formulas are neutralized", () => {
  assert.equal(safeText('=HYPERLINK("http://x")'), `'=HYPERLINK("http://x")`);
  assert.equal(safeText("+1"), "'+1");
  assert.equal(safeText("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(safeText("Normal"), "Normal");
  const evil = dep({ lines: [{ accountName: "=cmd|' /C calc'!A0", className: "-2+3", debit: "5.00", credit: "0.00", memo: "+evil" }, { accountName: "Bank", className: null, debit: "0.00", credit: "5.00", memo: null }] });
  const { rows } = buildQboJournalCsv([evil]);
  assert.ok(rows[0].accountName.startsWith("'="));
  assert.ok(rows[0].className.startsWith("'-"));
});

test("problems: missing account, empty and unbalanced deposits", () => {
  const noAccount = dep({ lines: [{ accountName: null, className: null, debit: "5.00", credit: "0.00", memo: null }, { accountName: "Bank", className: null, debit: "0.00", credit: "5.00", memo: null }] });
  assert.ok(buildQboJournalCsv([noAccount]).problems.some((p) => p.includes("no account")));
  assert.ok(buildQboJournalCsv([dep({ lines: [] })]).problems.some((p) => p.includes("no entry lines")));
  const off = dep({ lines: [{ accountName: "Bank", className: null, debit: "5.00", credit: "0.00", memo: null }, { accountName: "Inc", className: null, debit: "0.00", credit: "4.99", memo: null }] });
  assert.ok(buildQboJournalCsv([off]).problems.some((p) => p.includes("balance")));
});

test("usDate converts and rejects junk", () => {
  assert.equal(usDate("2026-01-09"), "01/09/2026");
  assert.throws(() => usDate("09/04/2026"));
});
