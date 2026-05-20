/**
 * /oauth/error?reason=...
 *
 * Server component. Maps a stable reason code to a human message and gives
 * the user a primary "Try again" CTA and a secondary "Contact support" link.
 *
 * Public page — no auth gating, since the user reaching here is whoever
 * was attempting an install and may not be logged into Donor HQ.
 *
 * Built with plain HTML + Tailwind (no shadcn Button/Card) so this stays a
 * pure Server Component — see the note in the success page for why.
 */
import { AlertCircle } from "lucide-react";
import type { OauthErrorReason } from "@/lib/ghl/types";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ reason?: string; detail?: string }>;
}

const REASON_MESSAGES: Record<OauthErrorReason, string> = {
  invalid_state:
    "The installation link expired or is invalid. Please try installing again.",
  missing_code:
    "GoHighLevel did not return an authorization code. Please try installing again.",
  token_exchange_failed:
    "We couldn't complete the connection with GoHighLevel. Please try again.",
  location_fetch_failed:
    "We connected, but couldn't fetch your sub-account details. Please contact support.",
  storage_failed:
    "We received your connection but couldn't save it. Please try again or contact support.",
  missing_location:
    "We couldn't find a sub-account for this installation. Please try installing again.",
  unknown:
    "Something went wrong. Please try again or contact support.",
};

function getMessage(reason: string | undefined): string {
  if (reason && reason in REASON_MESSAGES) {
    return REASON_MESSAGES[reason as OauthErrorReason];
  }
  return REASON_MESSAGES.unknown;
}

export default async function OAuthErrorPage({ searchParams }: PageProps) {
  const { reason, detail } = await searchParams;
  const message = getMessage(reason);

  // GHL_INSTALL_URL is the entry point that sets the state cookie and
  // redirects to GHL. Fall back to /api/oauth/install (same thing,
  // just relative) so the "Try again" button always works.
  const installUrl = process.env.GHL_INSTALL_URL || "/api/oauth/install";
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "support@donorhq.com";

  return (
    <div className="w-full max-w-md rounded-xl border bg-card py-5 text-card-foreground shadow-sm">
      <div className="flex flex-col items-center px-6 py-8 text-center">
        <img
          src="https://storage.googleapis.com/msgsndr/0lb5xbd0qHmaEqPUPc2N/media/f179ef7a-75f3-4c56-9fdd-85bc428972fb.png"
          alt="Donor HQ"
          className="mb-6 h-12 w-auto"
        />

        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertCircle className="h-7 w-7" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">Connection failed</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{message}</p>

        {reason && (
          <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            Reason: {reason}
          </p>
        )}

        {detail && (
          // Surface the actual upstream error message — helps diagnose
          // GHL-side issues like redirect_uri mismatch or invalid_client.
          <p className="mt-1.5 max-w-full break-words text-[11px] text-muted-foreground/70">
            {detail}
          </p>
        )}

        <a
          href={installUrl}
          className="mt-6 inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
        >
          Try again
        </a>
        <a
          href={`mailto:${supportEmail}?subject=${encodeURIComponent("Donor HQ install issue")}`}
          className="mt-2 inline-flex h-9 w-full items-center justify-center rounded-md border bg-card px-4 py-2 text-sm font-medium shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          Contact support
        </a>
      </div>
    </div>
  );
}
