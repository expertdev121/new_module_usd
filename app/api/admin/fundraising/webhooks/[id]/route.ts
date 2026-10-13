/** DELETE /api/admin/fundraising/webhooks/:id */
import { NextResponse } from "next/server";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";
import { deleteWebhook } from "@/lib/fundraising/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const { id } = await params;
  const deleted = await deleteWebhook(guard.session.user.locationId, Number(id));
  if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true, id: deleted.id });
}
