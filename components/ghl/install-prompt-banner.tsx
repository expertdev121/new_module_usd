"use client";

/**
 * Banner that surfaces "you need to install the DonorHQ app in your GHL
 * sub-account" when the current admin's location has no working OAuth
 * connection. Polled once per mount via /api/admin/ghl-connection-status.
 *
 * Visible only when:
 *   - The viewer is signed in
 *   - The viewer's session has a locationId (so they're a real admin)
 *   - canSync === false (no Location token AND no Company fallback)
 *
 * Otherwise it renders nothing (so the page is unchanged for connected
 * admins). The banner intentionally lives at the top of the page content
 * (not the sidebar) so it stays visible while the admin works.
 */
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Plug, AlertTriangle, ExternalLink } from "lucide-react";

interface ConnectionStatus {
  canSync: boolean;
  reason: string;
  message: string;
  installUrl: string | null;
  locationId: string | null;
}

export function GhlInstallPromptBanner() {
  const { data: session, status } = useSession();
  const [data, setData] = useState<ConnectionStatus | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    if (!session?.user?.locationId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/ghl-connection-status", {
          cache: "no-store",
        });
        if (!res.ok) return;
        const body = (await res.json()) as ConnectionStatus;
        if (!cancelled) setData(body);
      } catch {
        /* silent — banner is non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status, session?.user?.locationId]);

  // Render nothing until we know, or if the location is connected.
  if (!data) return null;
  if (data.canSync) return null;
  if (dismissed) return null;

  // The banner content differs slightly between "never installed" and
  // "previously installed but token revoked", because the recovery is
  // different (install vs reinstall).
  const isRevoked = data.reason === "all_revoked";

  return (
    <Card className="mb-4 border-amber-200 bg-amber-50/60">
      <CardContent className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
            {isRevoked ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <Plug className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-amber-900">
              {isRevoked
                ? "Reconnect Donor HQ to GoHighLevel"
                : "Connect Donor HQ to GoHighLevel"}
            </h2>
            <p className="mt-0.5 text-sm text-amber-900/85">
              {isRevoked
                ? "Your previous GHL connection was revoked. Reinstall the Donor HQ app on your GoHighLevel sub-account to resume syncing contacts, tags, and payments."
                : "The Donor HQ app isn't installed on your GoHighLevel sub-account yet. Install it to automatically sync contacts, tags, and payments — or contact the GiveSuite team for help."}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {data.installUrl && (
              <Button asChild size="sm" className="bg-amber-700 hover:bg-amber-800">
                <a href={data.installUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {isRevoked ? "Reinstall app" : "Install in GHL"}
                </a>
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
            >
              Dismiss
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
