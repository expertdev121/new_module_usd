/**
 * GET   /api/admin/accounting/ledger — chart of accounts + classes for this location.
 * POST  /api/admin/accounting/ledger — import rows parsed from the uploaded CSV
 *       ({ kind: "account" | "class", rows: [{ name, number?, type?, active? }] }).
 * PATCH /api/admin/accounting/ledger — mark one account/class active or inactive.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";
import { importLedger, listLedger, setLedgerActive } from "@/lib/accounting/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 5000;

const ImportBody = z.object({
  kind: z.enum(["account", "class"]),
  rows: z
    .array(
      z.object({
        name: z.string().trim().min(1, "Every row needs a name").max(200),
        number: z.string().trim().max(50).nullish(),
        type: z.string().trim().max(100).nullish(),
        active: z.boolean().optional(),
      }),
    )
    .min(1, "The file has no rows")
    .max(MAX_ROWS, `At most ${MAX_ROWS} rows per upload`),
});

const PatchBody = z.object({
  kind: z.enum(["account", "class"]),
  id: z.number().int().positive(),
  active: z.boolean(),
});

export async function GET() {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    return NextResponse.json(await listLedger(guard.session.user.locationId));
  } catch (err) {
    return accountingErrorResponse("accounting-ledger-get", err);
  }
}

export async function POST(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const body = ImportBody.parse(await req.json());
    const result = await importLedger(guard.session.user.locationId, guard.userId, body.kind, body.rows);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return accountingErrorResponse("accounting-ledger-post", err);
  }
}

export async function PATCH(req: Request) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const body = PatchBody.parse(await req.json());
    await setLedgerActive(guard.session.user.locationId, guard.userId, body.kind, body.id, body.active);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return accountingErrorResponse("accounting-ledger-patch", err);
  }
}
