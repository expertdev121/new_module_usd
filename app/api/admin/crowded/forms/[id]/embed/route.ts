/**
 * GET /api/admin/crowded/forms/[id]/embed
 *
 * Returns the two embed snippets the admin copy-pastes into their
 * external site (church website, GHL funnel, Wix page, etc.):
 *
 *   - iframe — full-form embedded inline
 *   - button — one-line <script> that opens the form in a centred modal
 *
 * Both snippets reference `formId` only; the form's current branding +
 * fields are always fetched live so admins can keep editing the form
 * without re-pasting the snippet anywhere.
 */
import { NextResponse, type NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { crowdedForms } from "@/lib/db/schema-crowded";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";
import { getCanonicalAppUrl } from "@/lib/config/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;

  const { id } = await params;
  const formId = parseInt(id, 10);
  if (Number.isNaN(formId)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }

  const [form] = await db
    .select()
    .from(crowdedForms)
    .where(
      and(
        eq(crowdedForms.id, formId),
        eq(crowdedForms.locationId, guard.session.user.locationId),
      ),
    )
    .limit(1);
  if (!form) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const appUrl = getCanonicalAppUrl();
  const donateUrl = `${appUrl}/donate/${form.id}`;
  const loaderUrl = `${appUrl}/embed/crowded-v1.js`;

  // 1) Inline iframe — responsive, transparent background so it blends
  // into whatever wrapper page it lands on.
  const iframeSnippet =
    `<iframe\n` +
    `  src="${donateUrl}"\n` +
    `  width="100%" height="950" style="border:0; background:transparent"\n` +
    `  allow="payment" loading="lazy"\n` +
    `  title="${escapeAttr(form.name)} — Donate">\n` +
    `</iframe>`;

  // 2) Button-popup — a single <script> tag draws a styled button; on
  //    click it opens the donate URL in a centred modal iframe. The
  //    loader script handles modal + close + escape key.
  const buttonText = form.submitLabel || "Donate";
  const buttonSnippet =
    `<script src="${loaderUrl}"\n` +
    `        data-form="${form.id}"\n` +
    `        data-text="${escapeAttr(buttonText)}"\n` +
    `        async></script>`;

  return NextResponse.json({
    formId: form.id,
    donateUrl,
    iframeSnippet,
    buttonSnippet,
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
