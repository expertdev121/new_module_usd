/**
 * POST /api/admin/crowded/chapters
 *
 * Proxies `GET /api/v1/chapters` on Crowded. Used by the connect screen:
 * admin pastes a token → we validate it + show them the chapter picker.
 *
 * NOT a GET because the API token comes in the request body, not from
 * stored creds. We don't want it landing in server access logs.
 */
import { NextResponse, type NextRequest } from "next/server";
import { requireCrowdedAdmin } from "@/lib/crowded/auth-guard";
import { listChapters, CrowdedApiError } from "@/lib/crowded/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const guard = await requireCrowdedAdmin();
  if (guard.error) return guard.error;

  const body = (await req.json().catch(() => ({}))) as { apiToken?: string };
  const apiToken = body.apiToken?.trim();
  if (!apiToken) {
    return NextResponse.json(
      { error: "missing_token", message: "apiToken is required in the body." },
      { status: 400 },
    );
  }

  try {
    const chapters = await listChapters(apiToken);
    return NextResponse.json({
      chapters: chapters.map((c) => ({
        id: c.id,
        name: c.name,
        organizationId: c.organizationId ?? c.organization?.id ?? null,
        organizationName: c.organization?.name ?? null,
      })),
    });
  } catch (err) {
    if (err instanceof CrowdedApiError) {
      return NextResponse.json(
        {
          error: err.isAuthError ? "invalid_token" : "crowded_error",
          message: err.isAuthError
            ? "Crowded rejected this API key. Double-check the value and try again."
            : `Crowded API error (${err.status}). Try again or contact support.`,
        },
        { status: err.isAuthError ? 401 : 502 },
      );
    }
    return NextResponse.json(
      { error: "unknown", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
