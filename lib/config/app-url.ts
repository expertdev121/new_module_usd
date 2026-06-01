/**
 * Single source of truth for "what's the canonical URL of this app".
 *
 * Used by anything that needs to:
 *   - Generate links in emails (receipts, year-end letters)
 *   - Build OAuth redirect URIs
 *   - Tell GHL where to send webhooks
 *   - Print sign-in URLs in CLI scripts
 *
 * Resolution order (first non-empty wins):
 *   1. NEXT_PUBLIC_APP_URL                — the canonical public URL
 *   2. NEXTAUTH_URL                       — usually the same value
 *   3. VERCEL_URL (auto-injected)         — preview deployment fallback;
 *                                            we prepend `https://` since
 *                                            Vercel only gives us the host
 *   4. request origin (if request passed) — last-resort dev fallback
 *
 * No final hardcoded fallback. If none of the above resolve, the helper
 * throws — pushing the failure UP to wherever it was called from with a
 * clear message, rather than silently sending bad links into the wild.
 *
 * To change the production URL:
 *   • Set NEXT_PUBLIC_APP_URL in Vercel env (e.g. https://donorhq.givesuite.com)
 *   • Set NEXTAUTH_URL to the same value
 *   • Set GHL_REDIRECT_URI to NEXT_PUBLIC_APP_URL + '/api/oauth/callback'
 *   • Set NEXT_PUBLIC_GHL_INSTALL_URL (if you embed the install link)
 *   • Redeploy
 *
 * See docs/CUSTOM_DOMAIN_SETUP.md for the full checklist (incl. GHL
 * Marketplace dashboard updates).
 */

/** Strip a single trailing slash so callers can safely append paths. */
function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export interface AppUrlContext {
  /** Optional request — only needed in dev or for unusual deployments. */
  request?: Request;
  /** Optional protocol+host headers if you already extracted them. */
  protocol?: string | null;
  host?: string | null;
}

/**
 * Returns the canonical app URL with no trailing slash, e.g.
 * `https://donorhq.givesuite.com`.
 *
 * Pass a request when you're inside a route handler — it lets us fall
 * back to the inbound origin during local dev even if no env is set.
 */
export function getCanonicalAppUrl(ctx: AppUrlContext = {}): string {
  // 1. Explicit env (production / staging / preview with overrides).
  if (process.env.NEXT_PUBLIC_APP_URL) {
    return trimSlash(process.env.NEXT_PUBLIC_APP_URL);
  }
  if (process.env.NEXTAUTH_URL) {
    return trimSlash(process.env.NEXTAUTH_URL);
  }

  // 2. Vercel auto-injects VERCEL_URL on preview deployments. It's just
  // the host (no scheme), so prepend https. We don't use this on prod
  // because we want canonical URLs (vs. the per-commit preview ones).
  if (process.env.VERCEL_URL) {
    return `https://${trimSlash(process.env.VERCEL_URL)}`;
  }

  // 3. Request-derived (last resort, mostly for local dev).
  const headers = ctx.request?.headers;
  const host =
    ctx.host ?? headers?.get("x-forwarded-host") ?? headers?.get("host") ?? null;
  const proto =
    ctx.protocol ?? headers?.get("x-forwarded-proto") ?? "https";
  if (host) {
    return `${proto}://${trimSlash(host)}`;
  }

  throw new Error(
    "getCanonicalAppUrl: no app URL configured. Set NEXT_PUBLIC_APP_URL " +
      "(or NEXTAUTH_URL) in env, or pass a request to derive it from the " +
      "inbound origin.",
  );
}

/**
 * Returns the OAuth redirect URI GHL should call back to. Prefers an
 * explicit GHL_REDIRECT_URI override (some deploys want a different host
 * for OAuth than for everyday traffic); otherwise derived from the
 * canonical app URL.
 */
export function getOauthRedirectUri(ctx: AppUrlContext = {}): string {
  if (process.env.GHL_REDIRECT_URI) {
    return process.env.GHL_REDIRECT_URI;
  }
  return `${getCanonicalAppUrl(ctx)}/api/oauth/callback`;
}

/**
 * Returns the install entry URL we share with sub-account admins. Used
 * by the install-prompt banner and by external embeds.
 */
export function getInstallUrl(ctx: AppUrlContext = {}): string {
  if (process.env.NEXT_PUBLIC_GHL_INSTALL_URL) {
    return process.env.NEXT_PUBLIC_GHL_INSTALL_URL;
  }
  if (process.env.GHL_INSTALL_URL) {
    return process.env.GHL_INSTALL_URL;
  }
  return `${getCanonicalAppUrl(ctx)}/api/oauth/install`;
}
