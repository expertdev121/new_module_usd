-- ROLLBACK for drizzle/0030-0034 (accounting sync). NOT run automatically. Review before using.
-- Removes ONLY what the accounting migrations added. It does not touch donations, contacts or campaigns,
-- except dropping the nullable manual_donation.deposit_id column (the only change those migrations made
-- to an existing table). Deposits and QuickBooks sync history are lost: export anything you need first.
-- Run as one transaction:  psql "$URL" -1 -f drizzle/rollback/accounting_rollback.sql
SET LOCAL lock_timeout = '5s';

-- the audit-log trigger first (it blocks deletes on accounting_audit)
DROP TRIGGER IF EXISTS accounting_audit_no_change ON accounting_audit;
DROP FUNCTION IF EXISTS accounting_audit_immutable();

-- the link from gifts to deposits (this also drops its index and foreign key)
ALTER TABLE manual_donation DROP COLUMN IF EXISTS deposit_id;

-- children before parents
DROP TABLE IF EXISTS sync_results;
DROP TABLE IF EXISTS sync_runs;
DROP TABLE IF EXISTS ledger_connections;
DROP TABLE IF EXISTS deposit_transactions;
DROP TABLE IF EXISTS deposit_lines;
DROP TABLE IF EXISTS deposits;
DROP TABLE IF EXISTS export_files;
DROP TABLE IF EXISTS fund_map;
DROP TABLE IF EXISTS source_map;
DROP TABLE IF EXISTS ledger_dimensions;
DROP TABLE IF EXISTS ledger_accounts;
DROP TABLE IF EXISTS accounting_audit;
DROP TABLE IF EXISTS accounting_settings;
