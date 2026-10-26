/**
 * GET /api/admin/accounting/connection/callback — where Intuit sends the admin back after approving.
 * Verifies the signed state (same admin, same organization, not expired) before exchanging the code,
 * then stores the encrypted tokens. Always ends in a redirect back to the Accounting page; details of
 * a failure go to the server log, not the URL.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { companyName, exchangeCode } from "@/lib/accounting/qbo/client";
import { qboEnvironment } from "@/lib/accounting/qbo/config";
import { saveConnection } from "@/lib/accounting/qbo/connection";
import { verifyState } from "@/lib/accounting/qbo/state";
import { errorText } from "@/lib/accounting/sql-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const back = (result: string) => NextResponse.redirect(new URL(`/admin/accounting?tab=quickbooks&qbo=${result}`, req.url));
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;

  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back("denied");

  const code = sp.get("code");
  const realmId = sp.get("realmId");
  const state = sp.get("state");
  if (!code || !realmId || !state || !/^\d{1,20}$/.test(realmId)) return back("error");

  const parsed = verifyState(state);
  if (!parsed || parsed.locationId !== guard.session.user.locationId || parsed.userId !== guard.userId) {
    console.error("[qbo-callback] state rejected for location", guard.session.user.locationId);
    return back("error");
  }

  try {
    const tokens = await exchangeCode(code);
    const env = qboEnvironment();
    const name = await companyName({ env, realmId, accessToken: tokens.accessToken }).catch(() => null);
    await saveConnection({ locationId: parsed.locationId, userId: guard.userId, realmId, companyName: name, tokens, environment: env });
    return back("connected");
  } catch (err) {
    console.error("[qbo-callback] connect failed:", errorText(err));
    return back("error");
  }
}
