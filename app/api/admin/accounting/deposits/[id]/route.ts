/**
 * GET   /api/admin/accounting/deposits/:id — deposit with its gifts and lines
 *       (a preview of the entry while open; the stored lines once closed).
 * PATCH /api/admin/accounting/deposits/:id — { action: "add_gifts" | "remove_gifts" | "close" | "reopen" | "void",
 *       giftIds?, approveUnmapped? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAccountingAdmin } from "@/lib/accounting/auth-guard";
import { addGifts, closeDeposit, getDeposit, removeGifts, reopenDeposit, voidDeposit } from "@/lib/accounting/deposits";
import { accountingErrorResponse } from "@/lib/accounting/route-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const giftIds = z.array(z.number().int().positive()).min(1, "Pick at least one gift").max(500);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("add_gifts"), giftIds }),
  z.object({ action: z.literal("remove_gifts"), giftIds }),
  z.object({ action: z.literal("close"), approveUnmapped: z.boolean().optional() }),
  z.object({ action: z.literal("reopen") }),
  z.object({ action: z.literal("void") }),
]);

async function parseId(params: Promise<{ id: string }>) {
  const id = Number.parseInt((await params).id, 10);
  if (!Number.isInteger(id) || id <= 0) throw new z.ZodError([{ code: "custom", path: ["id"], message: "Invalid deposit id" }]);
  return id;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const id = await parseId(params);
    return NextResponse.json({ deposit: await getDeposit(guard.session.user.locationId, id) });
  } catch (err) {
    return accountingErrorResponse("accounting-deposit-get", err);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireAccountingAdmin();
  if (guard.error) return guard.error;
  try {
    const id = await parseId(params);
    const body = Body.parse(await req.json());
    const loc = guard.session.user.locationId;
    switch (body.action) {
      case "add_gifts":
        await addGifts(loc, guard.userId, id, body.giftIds);
        break;
      case "remove_gifts":
        await removeGifts(loc, guard.userId, id, body.giftIds);
        break;
      case "close":
        await closeDeposit(loc, guard.userId, id, body.approveUnmapped === true);
        break;
      case "reopen":
        await reopenDeposit(loc, guard.userId, id);
        break;
      case "void":
        await voidDeposit(loc, guard.userId, id);
        break;
    }
    return NextResponse.json({ ok: true, deposit: await getDeposit(loc, id) });
  } catch (err) {
    return accountingErrorResponse("accounting-deposit-patch", err);
  }
}
