import fs from "node:fs";
import postgres from "postgres";
const url = fs.readFileSync(".env","utf8").split("\n").find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g,"");
const sql = postgres(url,{ssl:"require",max:1});
const LOC = "92T9l8F6sMASmiOWLMP5";
try {
  await sql`
    INSERT INTO location_settings (location_id, account_type)
    VALUES (${LOC}, 'household')
    ON CONFLICT (location_id) DO UPDATE SET account_type = 'household', updated_at = NOW()
  `;
  const r = await sql`SELECT * FROM location_settings WHERE location_id=${LOC}`;
  console.log("✅ household mode set for PTI:", r[0]);
} finally { await sql.end({timeout:5}); }
