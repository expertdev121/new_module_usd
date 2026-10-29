/**
 * DonorHQ "Forgot password" flow.
 *
 * A 6-digit code is emailed to the user (through a GoHighLevel inbound-webhook
 * workflow), stored only as a sha256 hash with a 15-minute expiry, and limited
 * by attempt count and send rate so it cannot be brute forced or spammed. The
 * code is consumed on a successful reset.
 */
import { db } from "@/lib/db";
import { user, passwordResetCode, organizationName } from "@/lib/db/schema";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { createHash, randomInt } from "node:crypto";
import bcrypt from "bcryptjs";

const CODE_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

// The GHL workflow that emails the code. Overridable by env; the live URL is the
// default so the flow works without extra config.
const WEBHOOK_URL =
  process.env.PASSWORD_RESET_WEBHOOK_URL ||
  "https://services.leadconnectorhq.com/hooks/0lb5xbd0qHmaEqPUPc2N/webhook-trigger/ea7540e3-3520-44fc-ac4a-cfc83d1d45eb";

const normalizeEmail = (e: string) => (e ?? "").trim().toLowerCase();
const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");
const generateCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

export class PasswordResetError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

// Case-insensitive lookup (login is case-sensitive today; reset is forgiving),
// excluding soft-deleted/offboarded accounts.
async function findUserByEmail(email: string) {
  const rows = await db
    .select({ id: user.id, email: user.email, locationId: user.locationId })
    .from(user)
    .where(and(sql`lower(${user.email}) = ${normalizeEmail(email)}`, isNull(user.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

export async function requestPasswordReset(emailRaw: string): Promise<{ exists: boolean }> {
  const email = normalizeEmail(emailRaw);
  if (!email || !email.includes("@")) throw new PasswordResetError("Enter a valid email address.", 400);

  const found = await findUserByEmail(email);
  if (!found) return { exists: false };

  // Rate limit: cap codes per hour and keep a short cooldown between sends.
  const recent = await db
    .select({ createdAt: passwordResetCode.createdAt })
    .from(passwordResetCode)
    .where(
      and(
        eq(passwordResetCode.userId, found.id),
        gt(passwordResetCode.createdAt, new Date(Date.now() - 60 * 60 * 1000)),
      ),
    )
    .orderBy(desc(passwordResetCode.createdAt));
  if (recent.length >= MAX_CODES_PER_HOUR)
    throw new PasswordResetError("Too many reset requests. Please try again later.", 429);
  if (recent[0] && Date.now() - new Date(recent[0].createdAt).getTime() < RESEND_COOLDOWN_MS)
    throw new PasswordResetError("A code was just sent. Please wait a minute before requesting another.", 429);

  // Invalidate outstanding unconsumed codes, then issue a fresh one.
  await db
    .update(passwordResetCode)
    .set({ consumedAt: new Date() })
    .where(and(eq(passwordResetCode.userId, found.id), isNull(passwordResetCode.consumedAt)));

  const code = generateCode();
  await db.insert(passwordResetCode).values({
    userId: found.id,
    email: found.email,
    codeHash: hashCode(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  // Greeting name: the org name for the location, else the email local-part.
  let name = found.email.split("@")[0];
  if (found.locationId) {
    const org = await db
      .select({ orgName: organizationName.orgName })
      .from(organizationName)
      .where(eq(organizationName.locationId, found.locationId))
      .limit(1);
    if (org[0]?.orgName) name = org[0].orgName;
  }

  await sendCodeEmail({ email: found.email, name, code });
  return { exists: true };
}

async function sendCodeEmail(p: { email: string; name: string; code: string }) {
  // Field aliases are generous so the GHL workflow can map whichever it uses.
  const payload = {
    email: p.email,
    to: p.email,
    name: p.name,
    first_name: p.name,
    code: p.code,
    otp: p.code,
    reset_code: p.code,
    verification_code: p.code,
    type: "password_reset",
    app: "DonorHQ",
    message: `Your DonorHQ password reset code is ${p.code}. It expires in 15 minutes.`,
  };
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  } catch (err) {
    console.error("[password-reset] webhook send failed:", err instanceof Error ? err.message : String(err));
    throw new PasswordResetError("We couldn't send the reset email just now. Please try again in a moment.", 502);
  }
}

// The newest still-valid code for this email, or a PasswordResetError. A wrong
// code increments the attempt counter; a correct one does not consume the code
// (so the UI can verify, then collect the new password in a second step).
async function checkCode(email: string, code: string): Promise<{ userId: number }> {
  const found = await findUserByEmail(email);
  if (!found) throw new PasswordResetError("That code is invalid or has expired.", 400);

  const rows = await db
    .select()
    .from(passwordResetCode)
    .where(and(eq(passwordResetCode.userId, found.id), isNull(passwordResetCode.consumedAt)))
    .orderBy(desc(passwordResetCode.createdAt))
    .limit(1);
  const row = rows[0];
  if (!row) throw new PasswordResetError("That code is invalid or has expired.", 400);
  if (new Date(row.expiresAt).getTime() < Date.now())
    throw new PasswordResetError("That code has expired. Request a new one.", 400);
  if (row.attempts >= MAX_ATTEMPTS)
    throw new PasswordResetError("Too many incorrect attempts. Request a new code.", 429);

  if (hashCode((code ?? "").trim()) !== row.codeHash) {
    await db.update(passwordResetCode).set({ attempts: row.attempts + 1 }).where(eq(passwordResetCode.id, row.id));
    throw new PasswordResetError("That code is incorrect.", 400);
  }
  return { userId: found.id };
}

export async function verifyResetCode(email: string, code: string): Promise<{ valid: true }> {
  await checkCode(email, code);
  return { valid: true };
}

export async function resetPassword(email: string, code: string, newPassword: string): Promise<{ ok: true }> {
  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH)
    throw new PasswordResetError(`Your new password must be at least ${MIN_PASSWORD_LENGTH} characters.`, 400);

  const { userId } = await checkCode(email, code);
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await db.update(user).set({ passwordHash, updatedAt: new Date() }).where(eq(user.id, userId));

  // Consume this code and any siblings so none can be reused.
  await db
    .update(passwordResetCode)
    .set({ consumedAt: new Date() })
    .where(and(eq(passwordResetCode.userId, userId), isNull(passwordResetCode.consumedAt)));
  return { ok: true };
}
