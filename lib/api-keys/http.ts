/**
 * Shared request/response helpers for the public /api/v1 endpoints.
 * Keeps every route's success/error envelope identical and predictable.
 */
import { NextResponse } from "next/server";
import {
  authenticateApiRequest,
  requireScope,
  type ApiAuthContext,
} from "./authenticate";
import type { ApiScope } from "@/lib/db/schema-api";

export function apiOk(data: unknown, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function apiError(status: number, message: string, extra?: unknown) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ? { details: extra } : {}) },
    { status },
  );
}

/**
 * Authenticate + scope-check in one call. On success returns the tenant
 * context; on failure returns a ready-to-send NextResponse (check with
 * `"ctx" in result`).
 */
export async function authorize(
  req: Request,
  scope: ApiScope,
): Promise<{ ctx: ApiAuthContext } | { response: NextResponse }> {
  const auth = await authenticateApiRequest(req.headers);
  if (!auth.ok) return { response: apiError(auth.status, auth.error) };
  const scoped = requireScope(auth.ctx, scope);
  if (!scoped.ok) return { response: apiError(scoped.status, scoped.error) };
  return { ctx: auth.ctx };
}

/** Parse a JSON body, returning a typed error response on malformed input. */
export async function readJson(
  req: Request,
): Promise<{ body: Record<string, unknown> } | { response: NextResponse }> {
  try {
    const body = await req.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return { response: apiError(400, "Request body must be a JSON object.") };
    }
    return { body: body as Record<string, unknown> };
  } catch {
    return { response: apiError(400, "Request body is not valid JSON.") };
  }
}
