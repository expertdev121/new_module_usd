// Applies the accounting migrations: drizzle/003x_accounting*.sql, in order, in ONE transaction.
//
//   TARGET_DATABASE_URL=postgres://...  node .apply-accounting-migration.mjs [--dry-run]
//
// Safety:
//  - It only ever touches TARGET_DATABASE_URL, never the app's own DATABASE_URL by accident.
//  - If the target is the PRODUCTION database (the host in .env's DATABASE_URL) it refuses unless you pass
//    --production AND set CONFIRM_PRODUCTION=apply-accounting-migrations. On production it also refuses to
//    run if ANY of the new tables already exist (so it can never half-apply twice or run by surprise).
//  - lock_timeout (5s): if a long-running query holds manual_donation, it gives up instead of queueing and
//    blocking live donations. statement_timeout (120s) caps any single statement.
//  - One transaction: any error rolls everything back, leaving the database exactly as it was.
//  - --dry-run runs the real DDL inside the transaction, checks it, then ROLLS BACK (nothing is kept).
//  - After a real run it re-checks the tables and that no existing donation rows disappeared.
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const target = process.env.TARGET_DATABASE_URL;
if (!target) {
  console.error("TARGET_DATABASE_URL is not set. Pass the connection string of the database to migrate.");
  process.exit(1);
}

const key = (u) => {
  const x = new URL(u);
  return `${x.hostname.replace(/-pooler/, "")}${x.pathname}`;
};
// Where "production" comes from: PRODUCTION_DATABASE_URL, else DATABASE_URL in .env of THIS folder. If neither is
// available the script cannot tell a test branch from production, so it stops instead of assuming it is safe
// (a git worktree has no .env: running it there used to skip the production guard silently).
const prodLine = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL=")) : null;
const prodUrl = process.env.PRODUCTION_DATABASE_URL || (prodLine ? prodLine.slice(13).trim().replace(/^["']|["']$/g, "") : null);
if (!prodUrl) {
  console.error(
    "Refusing: cannot tell whether the target is production. There is no .env with DATABASE_URL in this folder." +
      "\n" +
      "Run it from the folder that has .env, or set PRODUCTION_DATABASE_URL to the production connection string.",
  );
  process.exit(1);
}
const isProd = key(prodUrl) === key(target);

if (isProd) {
  if (!args.has("--production") || process.env.CONFIRM_PRODUCTION !== "apply-accounting-migrations") {
    console.error(
      "Refusing: the target is the PRODUCTION database.\n" +
        "To run on production deliberately, pass --production AND set CONFIRM_PRODUCTION=apply-accounting-migrations.\n" +
        "Read docs/accounting-production-rollout.md first (restore point, quiet window).",
    );
    process.exit(1);
  }
  console.log("*** PRODUCTION target confirmed ***");
}

const TABLES = [
  "accounting_settings", "ledger_accounts", "ledger_dimensions", "fund_map", "source_map", "export_files", "deposits",
  "deposit_lines", "deposit_transactions", "accounting_audit", "ledger_connections", "sync_runs", "sync_results",
];
const files = fs.readdirSync("drizzle").filter((f) => /^003\d_accounting.*\.sql$/.test(f)).sort();
const ddl = files.map((f) => fs.readFileSync(path.join("drizzle", f), "utf8")).join("\n");
console.log("Migrations:", files.join(", "), dryRun ? "(DRY RUN: will roll back)" : "");

const sql = postgres(target, { ssl: "require", max: 1, connect_timeout: 30, onnotice: () => {} });
class DryRunDone extends Error {}

/** Runs reads/writes in a short transaction with the same timeouts, so NOTHING here can wait on a lock for long. */
async function guarded(fn) {
  return sql.begin(async (tx) => {
    await tx`set local lock_timeout = '5s'`;
    await tx`set local statement_timeout = '120s'`;
    return fn(tx);
  });
}

async function present(q) {
  const t = await q`select table_name from information_schema.tables where table_schema='public' and table_name = any(${TABLES})`;
  const c = await q`select 1 from information_schema.columns where table_schema='public' and table_name='manual_donation' and column_name='deposit_id'`;
  return { tables: t.map((r) => r.table_name), column: c.length > 0 };
}

try {
  // ---- pre-flight (read-only) ----
  const { before, snap } = await guarded(async (tx) => {
    const needed = await tx`select table_name from information_schema.tables where table_schema='public' and table_name in ('user','campaign','manual_donation')`;
    if (needed.length !== 3) throw new Error("Pre-flight failed: the user, campaign and manual_donation tables must exist.");
    const b = await present(tx);
    if (isProd && (b.tables.length > 0 || b.column)) {
      throw new Error(`Pre-flight failed: production already has ${b.tables.length} of the new tables${b.column ? " and manual_donation.deposit_id" : ""}. Not touching it. Inspect by hand.`);
    }
    const [s] = await tx`select count(*)::int as n, coalesce(max(id),0)::int as max_id from manual_donation`;
    return { before: b, snap: s };
  });
  console.log(`Pre-flight OK. manual_donation: ${snap.n} rows (max id ${snap.max_id}). New tables already present: ${before.tables.length}/13.`);

  // ---- the migration, all or nothing ----
  try {
    await sql.begin(async (tx) => {
      await tx`set local lock_timeout = '5s'`;
      await tx`set local statement_timeout = '120s'`;
      await tx.unsafe(ddl);
      const inTx = await present(tx);
      if (inTx.tables.length !== 13 || !inTx.column) throw new Error(`Verification inside the transaction failed (${inTx.tables.length}/13 tables, column ${inTx.column}). Rolling back.`);
      if (dryRun) throw new DryRunDone();
    });
  } catch (err) {
    if (err instanceof DryRunDone) {
      console.log("DRY RUN OK: the migrations apply cleanly and verify. Rolled back; nothing was changed.");
      process.exit(0);
    }
    throw err;
  }

  // ---- post-check ----
  const { after, now } = await guarded(async (tx) => {
    const a = await present(tx);
    const [n] = await tx`select count(*)::int as n, coalesce(max(id),0)::int as max_id from manual_donation`;
    return { after: a, now: n };
  });
  if (after.tables.length !== 13 || !after.column) throw new Error(`POST-CHECK FAILED: ${after.tables.length}/13 tables, column ${after.column}.`);
  if (now.n < snap.n) throw new Error(`POST-CHECK FAILED: manual_donation went from ${snap.n} to ${now.n} rows.`);
  console.log(`DONE. 13/13 accounting tables present; manual_donation.deposit_id present; manual_donation ${snap.n} -> ${now.n} rows (live donations may add rows, never remove).`);
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/lock timeout|canceling statement due to lock/i.test(msg)) {
    console.error("FAILED: could not get a lock within 5 seconds (a long-running query is using manual_donation). NOTHING was changed. Retry in a minute.");
  } else {
    console.error("FAILED:", msg);
  }
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
