/**
 * GHL webhook signature verification.
 *
 * GHL signs every Marketplace App webhook with one of two signatures:
 *
 *   1. X-GHL-Signature  — current, Ed25519 over the raw body bytes
 *   2. X-WH-Signature   — legacy, RSA-SHA256 (deprecated July 1, 2026)
 *
 * The IMPORTANT detail: the signature is computed against the RAW request
 * body bytes, BEFORE any JSON parsing. Read the body as a string, verify,
 * THEN parse.
 *
 * Public keys are baked into this module (they're public and shipped in
 * GHL's docs). They are NOT secrets.
 */
import crypto from "node:crypto";

// ─────────────────────────────────────────────────────────────────────────────
// Public keys — published by GHL, included verbatim from the brief.
// ─────────────────────────────────────────────────────────────────────────────

const GHL_ED25519_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

const GHL_RSA_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAokvo/r9tVgcfZ5DysOSC
Frm602qYV0MaAiNnX9O8KxMbiyRKWeL9JpCpVpt4XHIcBOK4u3cLSqJGOLaPuXw6
dO0t6Q/ZVdAV5Phz+ZtzPL16iCGeK9po6D6JHBpbi989mmzMryUnQJezlYJ3DVfB
csedpinheNnyYeFXolrJvcsjDtfAeRx5ByHQmTnSdFUzuAnC9/GepgLT9SM4nCpv
uxmZMxrJt5Rw+VUaQ9B8JSvbMPpez4peKaJPZHBbU3OdeCVx5klVXXZQGNHOs8gF
3kvoV5rTnXV0IknLBXlcKKAQLZcY/Q9rG6Ifi9c+5vqlvHPCUJFT5XUGG5RKgOKU
J062fRtN+rLYZUV+BjafxQauvC8wSWeYja63VSUruvmNj8xkx2zE/Juc+yjLjTXp
IocmaiFeAO6fUtNjDeFVkhf5LNb59vECyrHD2SQIrhgXpO4Q3dVNA5rw576PwTzN
h/AMfHKIjE4xQA1SZuYJmNnmVZLIZBlQAF9Ntd03rfadZ+yDiOXCCs9FkHibELhC
HULgCsnuDJHcrGNd5/Ddm5hxGQ0ASitgHeMZ0kcIOwKDOzOU53lDza6/Y09T7sYJ
PQe7z0cvj7aE4B+Ax1ZoZGPzpJlZtGXCsu9aTEGEnKzmsFqwcSsnw3JB31IGKAyk
T1hhTiaCeIY/OwwwNUY2yvcCAwEAAQ==
-----END PUBLIC KEY-----`;

export type SignatureVerificationResult =
  | { valid: true; scheme: "ed25519" | "rsa-sha256" }
  | { valid: false; reason: "missing" | "invalid" | "error" };

/**
 * Verify a webhook payload against either the Ed25519 (preferred) or RSA
 * (legacy) signature header. Caller passes both header values; the function
 * picks Ed25519 first if present, else falls back to RSA.
 *
 * @param rawBody  Raw request body as a UTF-8 string (NOT JSON-parsed).
 * @param ed25519Header Value of x-ghl-signature header, if present.
 * @param rsaHeader Value of x-wh-signature header, if present.
 */
export function verifyWebhookSignature(
  rawBody: string,
  ed25519Header: string | null,
  rsaHeader: string | null,
): SignatureVerificationResult {
  if (!ed25519Header && !rsaHeader) {
    return { valid: false, reason: "missing" };
  }

  // Prefer Ed25519 — it's the current scheme. RSA stays as a fallback until
  // GHL retires it on July 1, 2026.
  if (ed25519Header) {
    try {
      const sig = Buffer.from(ed25519Header, "base64");
      const ok = crypto.verify(
        null, // Ed25519 doesn't use a hash function — null is required
        Buffer.from(rawBody, "utf8"),
        GHL_ED25519_PUBLIC_KEY,
        sig,
      );
      if (ok) return { valid: true, scheme: "ed25519" };
      return { valid: false, reason: "invalid" };
    } catch {
      return { valid: false, reason: "error" };
    }
  }

  // RSA-SHA256 legacy fallback.
  try {
    const verifier = crypto.createVerify("SHA256");
    verifier.update(rawBody);
    verifier.end();
    const ok = verifier.verify(GHL_RSA_PUBLIC_KEY, rsaHeader!, "base64");
    if (ok) return { valid: true, scheme: "rsa-sha256" };
    return { valid: false, reason: "invalid" };
  } catch {
    return { valid: false, reason: "error" };
  }
}

/**
 * Returns a redacted preview of a signature header for safe logging.
 * `"abc...xyz9"` style — never the full value.
 */
export function maskSignature(header: string | null): string {
  if (!header) return "<missing>";
  if (header.length <= 8) return "<short>";
  return `${header.slice(0, 4)}...${header.slice(-4)}`;
}
