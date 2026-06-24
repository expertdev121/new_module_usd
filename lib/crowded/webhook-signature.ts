/**
 * Verify HMAC-SHA256 signatures on inbound Crowded webhooks.
 *
 * Crowded sends `X-Webhook-Signature: sha256=<hex>` and signs the body.
 * Their docs contradict themselves on WHAT they sign:
 *   - The prose says "the raw request body".
 *   - Their JS sample HMACs `JSON.stringify(payload)`.
 *
 * We try the raw body first (per prose), then fall back to a stringified
 * normalize as a second attempt. Both runs use timing-safe comparison.
 *
 * Returns:
 *   { valid: boolean, used: "raw" | "stringify" | null }
 *
 * If `valid` is false, the webhook is rejected (401). If `valid` is true
 * with `used === "stringify"`, we log a warning so the team knows which
 * mode is active — once Crowded confirms (§4.4 of the plan) we can lock
 * to one.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface SignatureCheckResult {
  valid: boolean;
  /** Which input matched, or null if neither did. */
  used: "raw" | "stringify" | null;
}

/**
 * Parse the X-Webhook-Signature header value.
 * Accepts either bare hex or `sha256=<hex>`.
 */
function parseSignature(header: string | null): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (trimmed.startsWith("sha256=")) {
    return trimmed.slice("sha256=".length);
  }
  return trimmed;
}

function constantTimeHexCompare(expected: string, actual: string): boolean {
  if (!expected || !actual) return false;
  if (expected.length !== actual.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(actual, "hex"));
  } catch {
    return false;
  }
}

/**
 * Verify a signature against the raw body. The caller must pass the
 * EXACT bytes received over the wire — not a re-stringified version.
 */
export function verifySignature(
  rawBody: string,
  headerValue: string | null,
  secret: string,
): SignatureCheckResult {
  const sig = parseSignature(headerValue);
  if (!sig) return { valid: false, used: null };
  if (!secret) return { valid: false, used: null };

  // Attempt 1: HMAC of the raw body (docs prose).
  const rawDigest = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (constantTimeHexCompare(sig, rawDigest)) {
    return { valid: true, used: "raw" };
  }

  // Attempt 2: HMAC of JSON.stringify(parsed body) — docs JS sample.
  // We do a normalize round-trip to remove any whitespace differences
  // between what Crowded signed and what we received.
  try {
    const normalized = JSON.stringify(JSON.parse(rawBody));
    const normDigest = createHmac("sha256", secret).update(normalized).digest("hex");
    if (constantTimeHexCompare(sig, normDigest)) {
      console.warn(
        "[crowded-webhook] signature matched STRINGIFIED payload, not raw body. " +
          "Once Crowded confirms which is canonical, lock to one in webhook-signature.ts.",
      );
      return { valid: true, used: "stringify" };
    }
  } catch {
    /* body isn't JSON — already rejected by the raw attempt */
  }

  return { valid: false, used: null };
}
