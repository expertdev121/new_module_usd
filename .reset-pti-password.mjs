/**
 * Reset password for the PTI admin user (id 23303 / officeofpti@gmail.com).
 * One-shot. Uses bcryptjs 12 rounds, same as manage-admins route.
 */
import fs from "node:fs";
import postgres from "postgres";
import bcrypt from "bcryptjs";

const url = fs.readFileSync(".env","utf8").split("\n")
  .find(l=>l.startsWith("DATABASE_URL=")).slice(13).trim().replace(/^["']|["']$/g,"");
const sql = postgres(url,{ssl:"require",max:1});

const EMAIL = "officeofpti@gmail.com";
const NEW_PASSWORD = "officeofpti@gmail.com";

try {
  const hash = await bcrypt.hash(NEW_PASSWORD, 12);
  const rows = await sql`
    UPDATE "user"
    SET password_hash = ${hash}, updated_at = NOW()
    WHERE email = ${EMAIL}
    RETURNING id, email, role, location_id
  `;
  if (rows.length === 0) {
    console.log("❌ no user found with that email");
  } else {
    for (const r of rows) {
      console.log(`✅ reset password for user id=${r.id} email=${r.email} role=${r.role} location=${r.location_id}`);
    }
    // sanity: verify the new hash matches
    const check = await bcrypt.compare(NEW_PASSWORD, hash);
    console.log("bcrypt verify:", check ? "PASS" : "FAIL");
  }
} finally {
  await sql.end({timeout:5});
}
