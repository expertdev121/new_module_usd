/**
 * QuickBooks Online journal-entry import CSV. Pure: no database.
 * One journal number per deposit (DHQ-<deposit id>), so every exported number traces back
 * to its deposit and QuickBooks rejects a duplicate import of the same entry.
 *
 * Columns follow QuickBooks Online's "import journal entries" template. AccountName must match
 * the account name in the org's QuickBooks exactly, and the date format is US (mm/dd/yyyy).
 * Verify both against a sandbox company before relying on this in production.
 */

export const QBO_HEADERS = [
  "*JournalNo",
  "*JournalDate",
  "*AccountName",
  "*Debits",
  "*Credits",
  "Description",
  "Name",
  "Currency",
  "Location",
  "Class",
] as const;

export interface ExportLine {
  accountName: string | null;
  className: string | null;
  /** Decimal strings like "123.45"; "0.00" means none. */
  debit: string;
  credit: string;
  memo: string | null;
}

export interface ExportDeposit {
  id: number;
  /** YYYY-MM-DD */
  depositDate: string;
  reference: string | null;
  lines: ExportLine[];
}

export interface ExportRow {
  journalNo: string;
  journalDate: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
  className: string;
  depositId: number;
}

export const journalNo = (depositId: number) => `DHQ-${depositId}`;

/** YYYY-MM-DD -> mm/dd/yyyy */
export function usDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) throw new Error(`Bad date: ${iso}`);
  return `${m[2]}/${m[3]}/${m[1]}`;
}

/** A leading = + - @ tab or CR makes spreadsheets run the cell as a formula; neutralize it. */
export function safeText(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const money = (v: string) => (Number.parseFloat(v) > 0 ? Number.parseFloat(v).toFixed(2) : "");

export function buildQboJournalRows(deposits: ExportDeposit[]): { rows: ExportRow[]; problems: string[] } {
  const rows: ExportRow[] = [];
  const problems: string[] = [];
  for (const d of deposits) {
    const total = (k: "debit" | "credit") => d.lines.reduce((s, l) => s + Math.round(Number.parseFloat(l[k]) * 100), 0);
    if (d.lines.length === 0) problems.push(`Deposit #${d.id} has no entry lines.`);
    if (total("debit") !== total("credit")) problems.push(`Deposit #${d.id} does not balance.`);
    for (const l of d.lines) {
      if (!l.accountName) {
        problems.push(`Deposit #${d.id} has a line with no account.`);
        continue;
      }
      const parts = [l.memo, `DonorHQ deposit #${d.id}`, d.reference ? `Ref ${d.reference}` : null].filter(Boolean);
      rows.push({
        journalNo: journalNo(d.id),
        journalDate: usDate(d.depositDate),
        accountName: safeText(l.accountName),
        debit: money(l.debit),
        credit: money(l.credit),
        description: safeText(parts.join(" | ")),
        className: l.className ? safeText(l.className) : "",
        depositId: d.id,
      });
    }
  }
  return { rows, problems };
}

export function buildQboJournalCsv(deposits: ExportDeposit[]): { csv: string; rows: ExportRow[]; problems: string[] } {
  const { rows, problems } = buildQboJournalRows(deposits);
  const lines = [QBO_HEADERS.join(",")];
  for (const r of rows) {
    lines.push([r.journalNo, r.journalDate, r.accountName, r.debit, r.credit, r.description, "", "", "", r.className].map(csvField).join(","));
  }
  return { csv: lines.join("\r\n") + "\r\n", rows, problems };
}
