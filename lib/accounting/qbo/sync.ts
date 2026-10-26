/**
 * Sync runs: post every closed, not-yet-posted deposit of a location to QuickBooks.
 * One run at a time per location (a unique index on sync_runs where status = 'running'), so the
 * nightly job and the Sync now button can never post the same deposit twice. Every deposit gets a
 * sync_results row with the outcome, and failures carry a plain-words reason for the Retry button.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { syncResults, syncRuns } from "@/lib/db/schema-accounting";
import { writeAuditSafe } from "../audit";
import { AccountingInputError, getSettings } from "../settings";
import { errorText, intArray, rows } from "../sql-helpers";
import { QboApiError, QboAuthError } from "./client";
import { QboConfigError, qboEnvironment } from "./config";
import { getAccessContext, getConnection, markNeedsReconnect } from "./connection";
import { PostProblem, postDeposit } from "./post";

const MAX_PER_RUN = 100;
const STALE_RUN_MS = 15 * 60 * 1000;

export type SyncTrigger = "manual" | "nightly" | "retry";

export interface SyncSummary {
  runId: number;
  status: "success" | "partial" | "failed";
  posted: number;
  skipped: number;
  failed: number;
  error: string | null;
  results: Array<{ depositId: number; status: "posted" | "failed" | "skipped"; externalId: string | null; error: string | null }>;
}

async function claimRun(locationId: string, trigger: SyncTrigger, userId: number | null): Promise<number> {
  const tryInsert = async () => {
    const [r] = await rows(sql`insert into sync_runs (location_id, trigger, started_by) values (${locationId}, ${trigger}, ${userId}) returning id`);
    return Number(r.id);
  };
  try {
    return await tryInsert();
  } catch (err) {
    if (!errorText(err).includes("sync_runs_one_running")) throw err;
    // A run is marked running. If it is stale (a crashed worker), fail it and take over; otherwise wait.
    const stale = await rows(sql`
      update sync_runs set status = 'failed', finished_at = now(), error = 'Timed out'
      where location_id = ${locationId} and status = 'running' and started_at < now() - (${STALE_RUN_MS / 1000} * interval '1 second')
      returning id`);
    if (stale.length === 0) throw new AccountingInputError("A sync is already running for this organization. Wait for it to finish.");
    return tryInsert();
  }
}

function plainError(err: unknown): string {
  if (err instanceof QboApiError && err.intuitTid) {
    // Intuit support asks for this id; keep it in the sync log and the server log.
    console.error("[qbo-sync] QuickBooks error", err.status, "intuit_tid", err.intuitTid, err.message);
    return `${err.message} (Intuit reference ${err.intuitTid})`;
  }
  if (err instanceof PostProblem || err instanceof QboApiError || err instanceof QboAuthError || err instanceof QboConfigError) return err.message;
  console.error("[qbo-sync] unexpected error:", errorText(err));
  return "Something went wrong while posting this deposit. It was not posted; try again.";
}

export async function runSync(params: {
  locationId: string;
  trigger: SyncTrigger;
  userId?: number | null;
  /** Retry one deposit only. */
  depositId?: number;
  /** Stop starting new deposits after this time (ms since epoch). */
  deadline?: number;
}): Promise<SyncSummary> {
  const { locationId, trigger, depositId } = params;
  const userId = params.userId ?? null;
  const deadline = params.deadline ?? Date.now() + 240_000;

  const conn = await getConnection(locationId);
  if (!conn || conn.status === "disconnected") throw new AccountingInputError("QuickBooks is not connected.");
  const settings = await getSettings(locationId);

  const runId = await claimRun(locationId, trigger, userId);
  const results: SyncSummary["results"] = [];
  let runError: string | null = null;

  const finish = async (): Promise<SyncSummary> => {
    const posted = results.filter((r) => r.status === "posted").length;
    const failed = results.filter((r) => r.status === "failed").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const status: SyncSummary["status"] = runError && results.length === 0 ? "failed" : failed > 0 || runError ? (posted > 0 ? "partial" : "failed") : "success";
    // All results and the run's closing update commit together (one HTTP transaction), not row by row.
    const closing = db.update(syncRuns).set({ status, finishedAt: new Date(), posted, skipped, failed, error: runError }).where(eq(syncRuns.id, runId));
    await db.batch(
      (results.length > 0
        ? [db.insert(syncResults).values(results.map((r) => ({ runId, depositId: r.depositId, status: r.status, externalId: r.externalId, errorMessage: r.error }))), closing]
        : [closing]) as never,
    );
    await writeAuditSafe({ locationId, userId, action: "qbo_sync", object: "sync_run", objectId: runId, after: { trigger, status, posted, failed, skipped, error: runError } });
    return { runId, status, posted, skipped, failed, error: runError, results };
  };

  const work = async () => {
  try {
    const ctx = await getAccessContext(locationId);
    const candidates = await rows(sql`
      select id from deposits
      where location_id = ${locationId} and status = 'closed' and external_id is null
        ${depositId ? sql`and id = ${depositId}` : sql``}
        ${settings.startDate ? sql`and deposit_date >= ${settings.startDate}` : sql``}
      order by deposit_date, id
      limit ${MAX_PER_RUN}`);

    for (const c of candidates) {
      const id = Number(c.id);
      if (Date.now() > deadline) {
        runError = "Stopped early to stay within the time limit. Run the sync again to continue.";
        break;
      }
      try {
        const r = await postDeposit({ ctx, locationId, userId, depositId: id, entryType: settings.entryType === "journal_entry" ? "JournalEntry" : "Deposit" });
        results.push({ depositId: id, status: "posted", externalId: r.externalId, error: null });
      } catch (err) {
        if (err instanceof QboAuthError) {
          await markNeedsReconnect(locationId, err.message);
          runError = err.message;
          results.push({ depositId: id, status: "failed", externalId: null, error: err.message });
          break; // every remaining deposit would fail the same way
        }
        results.push({ depositId: id, status: "failed", externalId: null, error: plainError(err) });
      }
    }
  } catch (err) {
    if (err instanceof QboAuthError) await markNeedsReconnect(locationId, err.message);
    runError = plainError(err);
  }
  };

  // The run row is already marked 'running'. If anything below throws, close it as failed instead of leaving
  // it 'running' (which would block every other sync for this organization until the stale-run timeout).
  let summary: SyncSummary | null = null;
  try {
    await work();
    summary = await finish();
    return summary;
  } finally {
    if (!summary) {
      await rows(sql`update sync_runs set status = 'failed', finished_at = now(), error = 'The run ended unexpectedly. Run the sync again.' where id = ${runId} and status = 'running'`).catch((e) =>
        console.error("[qbo-sync] could not close run", runId, errorText(e)),
      );
    }
  }
}

export async function listSyncRuns(locationId: string, limit = 20) {
  const runs = await rows(sql`
    select id, trigger, status, started_at::text as started_at, finished_at::text as finished_at, posted, skipped, failed, error
    from sync_runs where location_id = ${locationId} order by id desc limit ${limit}`);
  const ids = runs.map((r) => Number(r.id));
  const results = ids.length
    ? await rows(sql`
        select sr.run_id, sr.deposit_id, sr.status, sr.external_id, sr.error_message, d.source, d.deposit_date::text as deposit_date, d.gross::text as gross, d.status as deposit_status
        from sync_results sr join deposits d on d.id = sr.deposit_id
        where sr.run_id = any(${intArray(ids)}) and d.location_id = ${locationId}
        order by sr.id`)
    : [];
  return runs.map((r) => ({
    id: Number(r.id),
    trigger: String(r.trigger),
    status: String(r.status),
    startedAt: String(r.started_at),
    finishedAt: (r.finished_at as string | null) ?? null,
    posted: Number(r.posted),
    skipped: Number(r.skipped),
    failed: Number(r.failed),
    error: (r.error as string | null) ?? null,
    results: results
      .filter((x) => Number(x.run_id) === Number(r.id))
      .map((x) => ({
        depositId: Number(x.deposit_id),
        status: String(x.status),
        externalId: (x.external_id as string | null) ?? null,
        error: (x.error_message as string | null) ?? null,
        source: String(x.source),
        depositDate: String(x.deposit_date),
        gross: String(x.gross),
        // A failed result is only retryable while the deposit is still closed and unposted.
        retryable: x.status === "failed" && x.deposit_status === "closed",
      })),
  }));
}

/** Locations with the nightly switch on and a live connection. */
export async function locationsForNightlySync(): Promise<string[]> {
  const list = await rows(sql`
    select s.location_id from accounting_settings s
    join ledger_connections c on c.location_id = s.location_id
    where s.auto_sync_enabled = true and c.status = 'active' and c.environment = ${qboEnvironment()}
    order by s.location_id`);
  return list.map((r) => String(r.location_id));
}

/** Nightly job: every opted-in location in turn, until the time budget is spent. */
export async function runNightlySyncs(budgetMs = 240_000) {
  const deadline = Date.now() + budgetMs;
  const out: Array<{ locationId: string; status: string; posted: number; failed: number; error: string | null }> = [];
  for (const locationId of await locationsForNightlySync()) {
    if (Date.now() > deadline) {
      out.push({ locationId, status: "skipped", posted: 0, failed: 0, error: "Out of time; will run next night." });
      continue;
    }
    try {
      const s = await runSync({ locationId, trigger: "nightly", deadline });
      out.push({ locationId, status: s.status, posted: s.posted, failed: s.failed, error: s.error });
    } catch (err) {
      out.push({ locationId, status: "error", posted: 0, failed: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return out;
}
