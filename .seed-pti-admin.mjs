/**
 * Seed a PTI admin sub-account. Idempotent — safe to re-run.
 * - Creates a `user` row (role=admin, accessType=full) if one with the same
 *   email doesn't already exist.
 * - Creates an `organization_name` row for the location if none exists.
 * Password is hashed with bcryptjs 12 rounds (same as the manage-admins route).
 */
import fs from "node:fs";
import postgres from "postgres";
import bcrypt from "bcryptjs";

const url = fs
  .readFileSync(".env", "utf8")
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice(13)
  .trim()
  .replace(/^["']|["']$/g, "");
const sql = postgres(url, { ssl: "require", max: 1 });

const LOCATION_ID = "92T9l8F6sMASmiOWLMP5";
const EMAIL = "officeofpti@gmail.com";
const PASSWORD = "officeofpti@gmail.com";
const ORG_NAME = "PTI";

try {
  const existing = await sql`
    SELECT id, email, role, location_id
    FROM "user"
    WHERE email = ${EMAIL}
    LIMIT 1
  `;
  if (existing.length > 0) {
    console.log(
      `↺ user already exists: id=${existing[0].id} role=${existing[0].role} location_id=${existing[0].location_id}`,
    );
  } else {
    const hash = await bcrypt.hash(PASSWORD, 12);
    const [row] = await sql`
      INSERT INTO "user" (email, password_hash, location_id, role, status, access_type, is_active)
      VALUES (${EMAIL}, ${hash}, ${LOCATION_ID}, 'admin', 'active', 'full', TRUE)
      RETURNING id, email, role, location_id
    `;
    console.log(`✅ created user id=${row.id} email=${row.email} role=${row.role} location=${row.location_id}`);
  }

  const org = await sql`
    SELECT id, org_name FROM organization_name WHERE location_id = ${LOCATION_ID} LIMIT 1
  `;
  if (org.length > 0) {
    console.log(`↺ organization_name already set for this location: "${org[0].org_name}"`);
  } else {
    const [row] = await sql`
      INSERT INTO organization_name (location_id, org_name)
      VALUES (${LOCATION_ID}, ${ORG_NAME})
      RETURNING id, org_name
    `;
    console.log(`✅ created organization_name id=${row.id} name="${row.org_name}"`);
  }

  console.log(`\nSub-account ready:`);
  console.log(`  URL      : https://donorhq.givesuite.com/auth/login`);
  console.log(`  Email    : ${EMAIL}`);
  console.log(`  Password : ${PASSWORD}`);
  console.log(`  Location : ${LOCATION_ID}`);
  console.log(`\nTip: change this password after first login via /admin/profile.`);
} finally {
  await sql.end({ timeout: 5 });
}
