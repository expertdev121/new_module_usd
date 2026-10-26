/**
 * QuickBooks journal-entry CSV export of closed deposits. Exporting is the moment a deposit
 * becomes "exported": the file is stored, and the deposits are locked to it in one atomic
 * statement, so a deposit can never be exported twice and a half-finished export can't happen.
 */
import { sql } from "drizzle-orm";
import { auditCte } from "./audit";
import { blockMessage, driftFor } from "./gift-drift";
import { AccountingInputError } from "./settings";
import { buildQboJournalCsv, type ExportDeposit } from "./qbo-csv";
import { intArray, rows } from "./sql-helpers";

const MAX_DEPOSITS = 200;
export const QBO_TEMPLATE = "qbo_journal_csv";

function cleanIds(depositIds: number[]): number[] {
  const ids = Array.from(new Set(depositIds));
  if (ids.length === 0) throw new AccountingInputError("Pick at least one deposit.");
  if (ids.length > MAX_DEPOSITS) throw new AccountingInputError(`Export at most ${MAX_DEPOSITS} deposits at a time.`);
  return ids;
}

/** Closed deposits of this location with their stored lines. Anything else is refused. */
async function loadClosed(locationId: string, ids: number[]) {
  const deps = await rows(sql`
    select id, deposit_date::text as deposit_date, external_ref, status
    from deposits where id = any(${intArray(ids)}) and location_id = ${locationId}`);
  if (deps.length !== ids.length) throw new AccountingInputError("Some of those deposits were not found.");
  const notClosed = deps.find((d) => d.status !== "closed");
  if (notClosed) {
    throw new AccountingInputError(
      notClosed.status === "exported"
        ? `Deposit #${notClosed.id} was already exported.`
        : `Deposit #${notClosed.id} is ${notClosed.status}. Only closed deposits can be exported.`,
    );
  }
  const lines = await rows(sql`
    select dl.deposit_id, la.name as account_name, la.active as account_active, ld.name as class_name,
           dl.debit::text as debit, dl.credit::text as credit, dl.memo
    from deposit_lines dl
    left join ledger_accounts la on la.id = dl.account_id
    left join ledger_dimensions ld on ld.id = dl.dimension_id
    where dl.deposit_id = any(${intArray(ids)})
    order by dl.deposit_id, dl.credit desc, dl.id`);

  const inactive = new Set<string>();
  const exportDeposits: ExportDeposit[] = deps
    .sort((a, b) => Number(a.id) - Number(b.id))
    .map((d) => ({
      id: Number(d.id),
      depositDate: String(d.deposit_date),
      reference: (d.external_ref as string | null) ?? null,
      lines: lines
        .filter((l) => Number(l.deposit_id) === Number(d.id))
        .map((l) => {
          if (l.account_name && l.account_active === false) inactive.add(String(l.account_name));
          return {
            accountName: (l.account_name as string | null) ?? null,
            className: (l.class_name as string | null) ?? null,
            debit: String(l.debit),
            credit: String(l.credit),
            memo: (l.memo as string | null) ?? null,
          };
        }),
    }));
  // A gift edited after the deposit was closed would make this file disagree with DonorHQ's own records.
  const drift = await driftFor(locationId, ids);
  const driftProblems = ids.filter((i) => drift.has(i)).map((i) => blockMessage(i, drift.get(i)!));
  return { exportDeposits, driftProblems, warnings: Array.from(inactive).map((n) => `Account "${n}" is marked inactive. QuickBooks may reject lines that use it.`) };
}

export async function previewExport(locationId: string, depositIds: number[]) {
  const ids = cleanIds(depositIds);
  const { exportDeposits, warnings, driftProblems } = await loadClosed(locationId, ids);
  const { rows: out, problems } = buildQboJournalCsv(exportDeposits);
  const cents = (v: string) => Math.round(Number(v || 0) * 100);
  return {
    depositCount: exportDeposits.length,
    rows: out,
    problems: [...driftProblems, ...problems],
    warnings,
    totalDebit: (out.reduce((s, r) => s + cents(r.debit), 0) / 100).toFixed(2),
    totalCredit: (out.reduce((s, r) => s + cents(r.credit), 0) / 100).toFixed(2),
  };
}

export async function createExport(locationId: string, userId: number | null, depositIds: number[]) {
  const ids = cleanIds(depositIds);
  const { exportDeposits, driftProblems } = await loadClosed(locationId, ids);
  if (driftProblems.length > 0) throw new AccountingInputError(driftProblems[0]);
  const { csv, problems } = buildQboJournalCsv(exportDeposits);
  if (problems.length > 0) throw new AccountingInputError(problems[0]);

  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
  const filename = `donorhq-qbo-journal-${stamp}.csv`;

  const [res] = await rows(sql`
    with ids as (
      select id from deposits
      where id = any(${intArray(ids)}) and location_id = ${locationId} and status = 'closed'
      for update
    ), f as (
      insert into export_files (location_id, template, deposit_count, filename, content, created_by)
      select ${locationId}, ${QBO_TEMPLATE}, (select count(*) from ids), ${filename}, ${csv}, ${userId}
      where (select count(*) from ids) = ${ids.length}
      returning id
    ), u as (
      update deposits
      set status = 'exported', exported_at = now(), exported_by = ${userId}, export_file_id = (select id from f), updated_at = now()
      where id in (select id from ids) and exists (select 1 from f)
      returning id
    ), ${auditCte("a", { locationId, userId, action: "export_create", object: "export_file", after: { filename, depositIds: ids, deposits: ids.length } }, { whenRows: "f", objectIdSql: sql`f.id::text` })}
    select (select id from f) as file_id, (select count(*)::int from u) as n`);

  if (res?.file_id == null) {
    throw new AccountingInputError("Some of those deposits changed while exporting (reopened, voided or exported). Nothing was exported. Refresh and try again.");
  }
  return { fileId: Number(res.file_id), filename, depositCount: ids.length };
}

export async function listExports(locationId: string) {
  const list = await rows(sql`
    select id, filename, deposit_count, created_at::text as created_at
    from export_files where location_id = ${locationId} and template = ${QBO_TEMPLATE}
    order by id desc limit 50`);
  return list.map((r) => ({
    id: Number(r.id),
    filename: (r.filename as string | null) ?? `export-${r.id}.csv`,
    depositCount: Number(r.deposit_count),
    createdAt: String(r.created_at),
  }));
}

export async function getExportFile(locationId: string, id: number) {
  const [r] = await rows(sql`select filename, content from export_files where id = ${id} and location_id = ${locationId}`);
  if (!r || typeof r.content !== "string") throw new AccountingInputError("Export file not found.");
  return { filename: (r.filename as string | null) ?? `export-${id}.csv`, content: r.content };
}
