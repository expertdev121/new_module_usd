/**
 * /oauth/success?locationId=...
 *
 * Server component. Looks up the connection row by locationId and renders
 * a branded confirmation card. Shows ONLY non-sensitive metadata
 * (location name, company name, connected timestamp).
 *
 * Public page — no auth gating, since the user reaching here is whoever
 * just installed and is likely not yet logged into Donor HQ.
 *
 * Built with plain HTML + Tailwind classes (no shadcn Button/Card) so this
 * stays a pure Server Component — `lib/utils.ts` mixes the `cn()` helper
 * with React hooks, which would otherwise force a "use client" boundary.
 */
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getTokenRecordByResource } from "@/lib/ghl/oauth-storage";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    locationId?: string;
    installed?: string;
    /** "1" when the install hit an existing row (re-install / reconnect) */
    reconnected?: string;
  }>;
}

function formatTimestamp(date: Date | null | undefined): string {
  if (!date) return "Just now";
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default async function OAuthSuccessPage({ searchParams }: PageProps) {
  // The query param is named `locationId` for backwards compat, but the
  // callback writes whatever resource_id was used (location OR company).
  const { locationId, installed, reconnected } = await searchParams;
  if (!locationId) {
    redirect("/oauth/error?reason=missing_location");
  }
  const isReconnect = reconnected === "1";

  const record = await getTokenRecordByResource(locationId);
  if (!record) {
    redirect("/oauth/error?reason=missing_location");
  }

  const dashboardUrl = process.env.NEXT_PUBLIC_DASHBOARD_URL || "/dashboard";
  const connectedAt = record.updatedAt ?? record.createdAt;
  // For agency installs, the callback passes `?installed=N` so we can show
  // "Connected to N sub-accounts" instead of details for just one.
  const installedCount = installed ? Number.parseInt(installed, 10) : 1;
  const isAgencyInstall = Number.isFinite(installedCount) && installedCount > 1;

  return (
    <div className="w-full max-w-md rounded-xl border bg-card py-5 text-card-foreground shadow-sm">
      <div className="flex flex-col items-center px-6 py-8 text-center">
        {/* Logo — same source as the sidebar so users instantly recognize Donor HQ. */}
        <img
          src="https://storage.googleapis.com/msgsndr/0lb5xbd0qHmaEqPUPc2N/media/f179ef7a-75f3-4c56-9fdd-85bc428972fb.png"
          alt="Donor HQ"
          className="mb-6 h-12 w-auto"
        />

        {/* Success icon — matches the colored-circle-accent pattern used on
            the contacts summary tiles. */}
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
          <CheckCircle2 className="h-7 w-7" />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">
          {isReconnect ? "Already connected ✓" : "Connection successful 🎉"}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          {isReconnect
            ? "This GoHighLevel account was already connected to Donor HQ — we refreshed the tokens. No action needed."
            : isAgencyInstall
              ? `Donor HQ is now connected to ${installedCount} sub-accounts in your GoHighLevel agency.`
              : "Donor HQ is now connected to your GoHighLevel sub-account."}
        </p>

        {/* Connection details — small, quiet, definition-list style. */}
        <dl className="mt-6 w-full divide-y rounded-lg border bg-muted/30 text-left">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">
              {record.resourceType === "Company" ? "Agency" : "Sub-account"}
            </dt>
            <dd className="truncate text-sm font-medium">
              {record.resourceType === "Company"
                ? record.companyName || record.companyId
                : record.locationName || record.locationId || record.resourceId}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">Company</dt>
            <dd className="truncate text-sm font-medium">
              {record.companyName || record.companyId}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3 px-4 py-2.5">
            <dt className="text-xs font-medium text-muted-foreground">Connected at</dt>
            <dd className="text-sm font-medium tabular-nums">
              {formatTimestamp(connectedAt)}
            </dd>
          </div>
        </dl>

        <a
          href={dashboardUrl}
          className="mt-6 inline-flex h-9 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
        >
          Continue to Dashboard
        </a>
        <p className="mt-3 text-xs text-muted-foreground">
          You can manage this connection anytime from your Donor HQ settings.
        </p>
      </div>
    </div>
  );
}
