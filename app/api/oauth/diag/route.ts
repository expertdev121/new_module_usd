/**
 * GET /api/oauth/diag
 *
 * Diagnostic endpoint for verifying the GHL OAuth configuration on any
 * environment (local, staging, prod). Returns which env vars are set, the
 * resolved redirect URI + authorize URL the install flow will use, and
 * whether the database can be reached.
 *
 * Safe to expose publicly — no secrets are returned, only presence flags
 * and the public-facing URLs the browser already sees.
 *
 * Use case:
 *   curl https://new-module-usd.vercel.app/api/oauth/diag
 *   → look at `redirectUri` and confirm it matches what's registered in the
 *     GHL Marketplace App settings. If they differ, token exchange will
 *     fail with TOKEN_EXCHANGE_FAILED.
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ghlOauthTokens } from "@/lib/db/schema-oauth";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function present(name: string): boolean {
  const value = process.env[name];
  return Boolean(value && value.trim().length > 0);
}

export async function GET() {
  const envChecks = {
    GHL_CLIENT_ID: present("GHL_CLIENT_ID"),
    GHL_CLIENT_SECRET: present("GHL_CLIENT_SECRET"),
    GHL_REDIRECT_URI: present("GHL_REDIRECT_URI"),
    NEXT_PUBLIC_APP_URL: present("NEXT_PUBLIC_APP_URL"),
    NEXT_PUBLIC_DASHBOARD_URL: present("NEXT_PUBLIC_DASHBOARD_URL"),
    GHL_API_BASE_URL: present("GHL_API_BASE_URL"),
    GHL_MARKETPLACE_BASE_URL: present("GHL_MARKETPLACE_BASE_URL"),
    GHL_API_VERSION: present("GHL_API_VERSION"),
    GHL_APP_SSO_KEY: present("GHL_APP_SSO_KEY"),
    GHL_SCOPES: present("GHL_SCOPES"),
    DATABASE_URL: present("DATABASE_URL"),
  };

  // Resolve the redirect URI the same way the OAuth code does — so the
  // caller can see EXACTLY what GHL will be told. Most token-exchange
  // failures come from a mismatch between this and what's registered in
  // the GHL Marketplace App settings.
  let resolvedRedirectUri: string | null = null;
  try {
    if (process.env.GHL_REDIRECT_URI) {
      resolvedRedirectUri = process.env.GHL_REDIRECT_URI;
    } else if (process.env.NEXT_PUBLIC_APP_URL) {
      resolvedRedirectUri = `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/oauth/callback`;
    }
  } catch {
    /* ignore */
  }

  const installUrl = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "")}/api/oauth/install`
    : null;

  // Database reachability check — pings the OAuth tokens table via the
  // typed Drizzle path (avoids the awkward return-type union from
  // db.execute).
  let dbReachable = false;
  let dbError: string | null = null;
  let oauthRowCount = 0;
  try {
    const rows = await db
      .select({ c: sql<number>`COUNT(*)::int` })
      .from(ghlOauthTokens);
    oauthRowCount = rows[0]?.c ?? 0;
    dbReachable = true;
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }

  const allRequiredPresent =
    envChecks.GHL_CLIENT_ID &&
    envChecks.GHL_CLIENT_SECRET &&
    (envChecks.GHL_REDIRECT_URI || envChecks.NEXT_PUBLIC_APP_URL) &&
    envChecks.DATABASE_URL;

  return NextResponse.json({
    ok: allRequiredPresent && dbReachable,
    env: envChecks,
    resolvedRedirectUri,
    installUrl,
    marketplaceBase:
      process.env.GHL_MARKETPLACE_BASE_URL || "https://marketplace.gohighlevel.com",
    apiBase: process.env.GHL_API_BASE_URL || "https://services.leadconnectorhq.com",
    db: {
      reachable: dbReachable,
      ghlOauthTokensRowCount: oauthRowCount,
      error: dbError,
    },
    hints: [
      "redirectUri above MUST match a value registered in your GHL Marketplace App → Auth → Redirect URLs.",
      "If marketplaceBase / apiBase look wrong, override via env: GHL_MARKETPLACE_BASE_URL, GHL_API_BASE_URL.",
      allRequiredPresent
        ? "Required env vars are set."
        : "MISSING REQUIRED ENV VARS — set them in Vercel → Settings → Environment Variables.",
    ],
  });
}
