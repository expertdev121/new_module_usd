/**
 * POST /api/accounting-confirm  { token }  — public (a signed link, no session).
 * Marks the alert email address in the link as confirmed. The page asks for a button press first, so a mail
 * scanner that merely opens the link cannot confirm anything.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmAlertEmail } from "@/lib/accounting/alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ token: z.string().min(10).max(1000) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, message: "This confirm link is not valid." }, { status: 400 });
  const result = await confirmAlertEmail(parsed.data.token);
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
