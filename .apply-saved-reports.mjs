import fs from "node:fs";
import postgres from "postgres";
const url = fs.readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g,"");
const sql = postgres(url,{ssl:"require",max:1});
try {
  await sql`
    CREATE TABLE IF NOT EXISTS saved_reports (
      id SERIAL PRIMARY KEY,
      location_id TEXT NOT NULL,
      report_key VARCHAR(64) NOT NULL,
      name VARCHAR(120) NOT NULL,
      params JSONB NOT NULL,
      created_by INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS saved_reports_location_idx ON saved_reports (location_id)`;
  await sql`CREATE INDEX IF NOT EXISTS saved_reports_key_idx ON saved_reports (report_key)`;
  console.log("✅ saved_reports table + indexes");
} finally { await sql.end({timeout:5}); }
