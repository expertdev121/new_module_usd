/**
 * POST /api/admin/crowded/connect
 *
 * Final step of the admin's connect flow:
 *   1. Take their pasted API token + selected chapter
 *   2. Validate token (call GET /chapters and confirm the chosen
 *      chapterId is in the returned list)
 *   3. Encrypt + persist to crowded_connections
 *   4. Auto-register the webhook → store the returned secret encrypted
 *   5. Return sanitized status
 *
 * If webhook registration fails (e.g. Crowded already has a webhook at
 * this URL for this partner), we don't fail the whole connect — we
 * persist the connection and surface a warning so the admin can re-try
 * webhook registration from the Settings page.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";
import {
  listChapters,
  registerWebhook,
  CrowdedApiError,
} from "@/lib/crowded/api-client";
import {
  sanitizeForClient,
  upsertConnection,
} from "@/lib/crowded/connection-storage";
import { getCanonicalAppUrl } from "@/lib/config/app-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConnectBody {
  apiToken?: string;
  chapterId?: string;
}

export async function POST(req: NextRequest) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;
  const locationId = guard.session.user.locationId;

  const body = (await req.json().catch(() => ({}))) as ConnectBody;
  const apiToken = body.apiToken?.trim();
  const chapterId = body.chapterId?.trim();

  if (!apiToken || !chapterId) {
    return NextResponse.json(
      {
        error: "missing_fields",
        message: "Both apiToken and chapterId are required.",
      },
      { status: 400 },
    );
  }

  // 1. Re-validate the token + confirm chapter ownership.
  let chapterName: string | null = null;
  let orgId: string | null = null;
  try {
    const chapters = await listChapters(apiToken);
    const match = chapters.find((c) => c.id === chapterId);
    if (!match) {
      return NextResponse.json(
        {
          error: "chapter_not_found",
          message:
            "The selected chapter isn't visible under this API token. Re-paste the token.",
        },
        { status: 400 },
      );
    }
    chapterName = match.name ?? null;
    orgId = match.organizationId ?? match.organization?.id ?? null;
  } catch (err) {
    if (err instanceof CrowdedApiError && err.isAuthError) {
      return NextResponse.json(
        { error: "invalid_token", message: "Crowded rejected this API key." },
        { status: 401 },
      );
    }
    return NextResponse.json(
      {
        error: "crowded_error",
        message:
          err instanceof Error ? err.message : "Failed to validate Crowded token.",
      },
      { status: 502 },
    );
  }

  // 2. Persist the connection (encryption inside upsertConnection).
  const conn = await upsertConnection({
    locationId,
    apiTokenPlain: apiToken,
    chapterId,
    chapterName,
    orgId,
    createdBy: guard.session.user.id
      ? parseInt(String(guard.session.user.id), 10) || null
      : null,
  });

  // 3. Register the webhook → store the secret.
  const webhookUrl = `${getCanonicalAppUrl()}/api/webhook/crowded`;
  let webhookWarning: string | null = null;
  try {
    const reg = await registerWebhook(apiToken, { url: webhookUrl });
    if (!reg.secret) {
      // Crowded didn't return the secret — race? The connection still
      // works for outbound calls; admin should disconnect+reconnect to
      // pick up a fresh secret.
      webhookWarning =
        "Webhook registered but no secret returned. Inbound webhooks won't be verified. Disconnect + reconnect to retry.";
    } else {
      const { setWebhookRegistration } = await import(
        "@/lib/crowded/connection-storage"
      );
      await setWebhookRegistration(locationId, reg.id, reg.secret);
    }
  } catch (err) {
    webhookWarning =
      err instanceof CrowdedApiError
        ? `Webhook registration failed (HTTP ${err.status}). Click Reconnect to retry.`
        : `Webhook registration failed: ${err instanceof Error ? err.message : String(err)}.`;
    console.error(
      `[crowded] webhook registration failed for location ${locationId}: ${webhookWarning}`,
    );
  }

  // 4. Audit.
  void (async () => {
    try {
      const { logAudit } = await import("@/lib/audit");
      await logAudit("crowded_connect", {
        entity: "crowded_connections",
        locationId,
        chapterId,
        chapterName,
        webhookWarning,
        triggeredBy: guard.session.user.email ?? guard.session.user.id,
      });
    } catch (auditErr) {
      console.error(
        "[crowded-connect] audit failed (non-fatal):",
        auditErr instanceof Error ? auditErr.message : String(auditErr),
      );
    }
  })();

  return NextResponse.json({
    success: true,
    warning: webhookWarning,
    connection: sanitizeForClient(conn),
  });
}
