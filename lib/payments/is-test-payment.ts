/**
 * Detects whether an incoming payment webhook payload is a TEST-mode charge
 * (Stripe test mode / GoHighLevel `liveMode: false`), so the sync can drop it
 * and DonorHQ only ever records real, live revenue.
 *
 * The various providers put the flag in different places and shapes, so this
 * scans the whole payload (bounded depth) for the well-known signals:
 *   - livemode / liveMode / live_mode  === false  (or the string "false")
 *   - mode / environment               === "test"
 *   - test / isTest / is_test          === true    (or the string "true")
 *
 * Returns true only on a positive test signal; an unknown/absent flag returns
 * false so real payments are never dropped by mistake.
 */
export function isTestPayment(payload: unknown, depth = 0): boolean {
  if (payload == null || depth > 6) return false;

  if (Array.isArray(payload)) {
    return payload.some((v) => isTestPayment(v, depth + 1));
  }
  if (typeof payload !== "object") return false;

  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const k = key.toLowerCase();

    // livemode / liveMode / live_mode = false  → test
    if ((k === "livemode" || k === "live_mode") &&
        (value === false || (typeof value === "string" && value.toLowerCase() === "false"))) {
      return true;
    }
    // mode / environment = "test"
    if ((k === "mode" || k === "environment") &&
        typeof value === "string" && value.toLowerCase() === "test") {
      return true;
    }
    // test / isTest / is_test = true
    if ((k === "test" || k === "istest" || k === "is_test") &&
        (value === true || (typeof value === "string" && value.toLowerCase() === "true"))) {
      return true;
    }

    // Recurse into nested objects (Stripe event.data.object, GHL
    // chargeSnapshot, custom-data envelopes, etc.).
    if (value && typeof value === "object" && isTestPayment(value, depth + 1)) {
      return true;
    }
  }
  return false;
}
