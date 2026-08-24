/**
 * Dashboard API-key management (session-authenticated, per account).
 *
 *   GET  /api/admin/api-keys   → list this account's keys (never the secret)
 *   POST /api/admin/api-keys   → mint a new key; returns the full token ONCE
 *
 * The raw token is shown exactly once, on creation. After that we only ever
 * hold its sha256, so it can never be re-displayed — the UI must tell the
 * user to copy it now.
 */
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { apiKey, API_SCOPES, type ApiScope } from "@/lib/db/schema-api";
import { desc, eq } from "drizzle-orm";
import { generateApiKey } from "@/lib/api-keys/keys";

/** Admin (incl. an impersonating super admin, whose role is "admin"). */
async function requireAccount() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const role = session.user.role;
  const locationId = session.user.locationId;
  if (role !== "admin" && role !== "super_admin") {
    return { error: NextResponse.json({ error: "Forbidden: admin access required" }, { status: 403 }) };
  }
  if (!locationId) {
    return { error: NextResponse.json({ error: "No account (locationId) on your session." }, { status: 400 }) };
  }
  return { locationId, userId: session.user.id ? Number(session.user.id) : null };
}

export async function GET() {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx.error;

  const keys = await db
    .select({
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes: apiKey.scopes,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
      createdAt: apiKey.createdAt,
    })
    .from(apiKey)
    .where(eq(apiKey.locationId, ctx.locationId))
    .orderBy(desc(apiKey.createdAt));

  return NextResponse.json({ keys });
}

export async function POST(request: NextRequest) {
  const ctx = await requireAccount();
  if ("error" in ctx) return ctx.error;

  let body: { name?: unknown; scopes?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* empty body is fine — we default everything */
  }

  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 120)
      : "Untitled key";

  // Default to both scopes; accept an explicit subset of the known scopes.
  let scopes: ApiScope[] = [...API_SCOPES];
  if (Array.isArray(body.scopes)) {
    const requested = body.scopes.filter(
      (s): s is ApiScope => typeof s === "string" && (API_SCOPES as readonly string[]).includes(s),
    );
    if (requested.length > 0) scopes = requested;
  }

  const generated = generateApiKey();

  const [created] = await db
    .insert(apiKey)
    .values({
      locationId: ctx.locationId,
      name,
      keyPrefix: generated.prefix,
      keyHash: generated.hash,
      scopes,
      createdBy: ctx.userId,
    })
    .returning({ id: apiKey.id, name: apiKey.name, keyPrefix: apiKey.keyPrefix, scopes: apiKey.scopes, createdAt: apiKey.createdAt });

  // The one and only time the full token is returned.
  return NextResponse.json(
    { key: created, token: generated.token },
    { status: 201 },
  );
}
