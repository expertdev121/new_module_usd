/**
 * POST /api/oauth/decrypt-sso
 *
 * Used when Donor HQ is embedded as a Custom Page inside the GHL UI
 * (iframe). The parent GHL window posts an encrypted session key via
 * postMessage; the embedded page sends it here to decrypt it and identify
 * which GHL user is using the app (so we can auto-login / scope queries).
 *
 * Request body:
 *   { "key": "<base64-encrypted-string-from-ghl>" }
 *
 * Response:
 *   200 OK  — JSON with userId, companyId, activeLocation, email, role, type
 *   400     — missing or invalid key
 *
 * The endpoint never logs the key or the decrypted payload (PII).
 */
import { NextResponse, type NextRequest } from "next/server";
import { decryptGhlSsoKey } from "@/lib/ghl/sso";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { key?: string };
  try {
    body = (await req.json()) as { key?: string };
  } catch {
    return NextResponse.json(
      { error: "invalid_body", message: "Body must be JSON with { key: string }" },
      { status: 400 },
    );
  }

  const key = body?.key;
  if (!key || typeof key !== "string" || key.trim().length === 0) {
    return NextResponse.json(
      { error: "missing_key", message: "Body must include a non-empty 'key' field" },
      { status: 400 },
    );
  }

  try {
    const payload = decryptGhlSsoKey(key);
    // Return the decrypted payload. The caller (our embedded UI) uses it
    // to identify the user without sending the raw key around.
    return NextResponse.json(payload);
  } catch (err) {
    console.error(
      "[ghl-sso] decrypt failed:",
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { error: "invalid_key", message: "Could not decrypt the SSO key" },
      { status: 400 },
    );
  }
}
