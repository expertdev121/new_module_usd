-- Keep the generated file with each export so it can be downloaded again (export history)
-- without touching deposit status. Idempotent; applied via .apply-accounting-migration.mjs.
ALTER TABLE export_files ADD COLUMN IF NOT EXISTS filename TEXT;
ALTER TABLE export_files ADD COLUMN IF NOT EXISTS content TEXT;
