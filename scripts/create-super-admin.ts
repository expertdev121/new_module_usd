/**
 * One-shot script to create (or update) a super_admin user.
 *
 *   node --env-file=.env --import tsx scripts/create-super-admin.ts \
 *     -- expertdeveloper121@gmail.com 'ExpertDev@321'
 *
 * Safe to re-run: if the email already exists, the script updates the role
 * and password instead of failing. No data is deleted.
 */
import { neon } from "@neondatabase/serverless";
import bcrypt from "bcryptjs";

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  const email = args[0]?.toLowerCase().trim();
  const password = args[1];

  if (!email || !password) {
    console.error("Usage: ... create-super-admin.ts <email> <password>");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL not set.");
    process.exit(1);
  }
  const sql = neon(url);

  const passwordHash = await bcrypt.hash(password, 12);

  // Look up existing user.
  const existing = (await sql`
    SELECT id, role, status, access_type FROM "user" WHERE email = ${email} LIMIT 1
  `) as { id: number; role: string; status: string; access_type: string }[];

  if (existing.length === 0) {
    const inserted = (await sql`
      INSERT INTO "user" (email, password_hash, role, status, access_type, is_active)
      VALUES (${email}, ${passwordHash}, 'super_admin', 'active', 'full', true)
      RETURNING id, email, role
    `) as { id: number; email: string; role: string }[];
    console.log(`\n✓ Created super_admin user:`);
    console.log(`    id: ${inserted[0].id}`);
    console.log(`    email: ${inserted[0].email}`);
    console.log(`    role: ${inserted[0].role}`);
  } else {
    const u = existing[0];
    await sql`
      UPDATE "user"
      SET password_hash = ${passwordHash},
          role = 'super_admin',
          status = 'active',
          access_type = 'full',
          is_active = true,
          updated_at = NOW()
      WHERE id = ${u.id}
    `;
    console.log(`\n✓ Existing user updated to super_admin:`);
    console.log(`    id: ${u.id}`);
    console.log(`    email: ${email}`);
    console.log(`    previous role: ${u.role}`);
    console.log(`    new role: super_admin`);
    console.log(`    password reset: yes`);
  }

  console.log(`\nSign in at: http://localhost:3000/auth/login`);
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
