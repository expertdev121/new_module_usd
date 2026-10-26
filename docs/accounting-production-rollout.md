# Accounting sync: production rollout checklist

What this adds to production: 13 new tables, one nullable column (`manual_donation.deposit_id`) and an
index on it. Nothing existing is changed, and no live code path uses the new tables until the accounting
page, the QuickBooks connection or the nightly cron is used. The migrations were rehearsed on a full-data
copy of the live database (apply, dry run, rollback, lock contention).

## Before you start (once)
- [ ] Nikhil has said yes to running the migrations (he did on 2026-10-26: "yes please add them").
- [ ] Pick a quiet time (not during a campaign push or a big donation day). The only effect on live traffic is
      that writes to `manual_donation` pause for about a second while the index is built.
- [ ] Code is reviewed and merged **separately from unrelated changes**. Commit only the accounting files
      (`lib/accounting/`, `lib/db/schema-accounting.ts`, `app/admin/accounting/`, `app/api/admin/accounting/`,
      `app/api/accounting-cron/`, `drizzle/003x_*` (0030-0033), plus the small edits to `components/dashboard/sidebar.tsx`,
      `middleware.ts`, `vercel.json`, `tsconfig.json`).

## 1. Restore point (2 minutes)
Neon console -> organization **Dev** -> project **levhatora** -> Branches -> **New Branch**.
Name `pre-accounting-<date>`, parent = the branch the live app uses (the one that is *Active*; it was
`USD Module`), "Branch data and schema", auto-delete **Never** until the rollout is confirmed good.
This is an instant, free copy you can restore from.

## 2. Dry run on production (changes nothing)
Run from the repo root, with the **production** connection string:
```bash
TARGET_DATABASE_URL="<production url>" CONFIRM_PRODUCTION=apply-accounting-migrations \
  node .apply-accounting-migration.mjs --production --dry-run
```
Expect: `Pre-flight OK ... New tables already present: 0/13` then `DRY RUN OK`.
It refuses to run on production unless **both** `--production` and `CONFIRM_PRODUCTION` are given, and it
refuses if any of the new tables already exist. (A dry run still takes the table lock for a moment inside a
transaction it then rolls back, so do it at the same quiet time.)

## 3. Apply
Same command without `--dry-run`:
```bash
TARGET_DATABASE_URL="<production url>" CONFIRM_PRODUCTION=apply-accounting-migrations \
  node .apply-accounting-migration.mjs --production
```
- One transaction: any error rolls everything back.
- If it prints `could not get a lock within 5 seconds`, nothing was changed. Wait a minute and retry.
- Expect `DONE. 13/13 accounting tables present ... manual_donation N -> N rows`.

## 4. Environment variables (Vercel -> Settings -> Environment Variables)
Add before the first use of the feature (sandbox first):
`QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI` (must match a Redirect URI registered in the Intuit app),
`QBO_ENVIRONMENT` (`sandbox`, later `production`), `ACCOUNTING_ENC_KEY` (`openssl rand -base64 32`; **keep a safe copy**,
losing it makes stored QuickBooks tokens unreadable and every org must reconnect), `CRON_SECRET` (probably set already).
The nightly cron endpoint refuses every request if `CRON_SECRET` is missing.

## 5. Deploy the code, then smoke-test
- [ ] Open `/admin/accounting` as an admin: all tabs load.
- [ ] Existing pages still work: dashboard, donations list, a manual donation save, a webhook donation arriving.
- [ ] Leave "nightly sync" **off** for every organization until the QuickBooks connection is tested live.
- [ ] Only then, in the Intuit developer portal, add the production Redirect URI and (later) switch to production keys.

## Rollback (if anything looks wrong)
Code first: redeploy the previous version (the accounting pages are the only thing that stops working).
Then, only if the tables must go, from the repo root:
```bash
node -e "const p=require('postgres');const fs=require('fs');const s=p(process.env.TARGET_DATABASE_URL,{ssl:'require',max:1});s.begin(t=>t.unsafe(fs.readFileSync('drizzle/rollback/accounting_rollback.sql','utf8'))).then(()=>{console.log('rolled back');return s.end()}).catch(e=>{console.error(e.message);process.exit(1)})"
```
It drops only the 13 tables, the audit trigger and `manual_donation.deposit_id`. Donations, contacts and campaigns
are untouched. Deposit and sync history are lost, so export anything needed first. The `pre-accounting-*` Neon
branch is the full fallback.

## Known follow-ups (not blockers)
- `lib/db/index.ts` hardcodes a production database URL as a fallback and its password is the same one used in
  chat during testing. Remove the fallback and rotate the password with Nikhil.
- Gifts edited after a deposit was closed are detected (blocked before sending, flagged after); posting an adjusting entry automatically is not built.
- Intuit production keys need an app assessment; check eligibility and platform fees for the company's country first.

## Never run `db:push` on this project
`drizzle.config.ts` only reads `lib/db/schema.ts`, and several things (partial unique indexes, CHECK constraints, the
audit-log trigger, the accounting tables themselves) live only in the hand-written SQL migrations. `pnpm db:push`
would show a diff that drops or alters them, and confirming it deletes deposits, mappings and QuickBooks connections.
Apply schema changes only through the `.apply-*.mjs` runners and the `drizzle/*.sql` files, as described above.
