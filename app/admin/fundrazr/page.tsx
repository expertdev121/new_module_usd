"use client";

/**
 * /admin/fundrazr — read-only campaign dashboard.
 *
 * Two sections:
 *  1. Connection card — paste ConnectionPoint organization ID + Save.
 *     (Validated server-side against ConnectionPoint before persisting.)
 *  2. Campaigns list — live GET from ConnectionPoint filtered by the
 *     saved org id. Table shows title, status, goal, raised,
 *     contributors, launched date, and an external link.
 *
 * MVP scope: no writes back to ConnectionPoint, no local caching. If
 * ConnectionPoint is slow the page shows a spinner; a refresh button
 * lets the admin re-pull without a full navigation.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Megaphone,
  RefreshCw,
  Save,
  Unplug,
} from "lucide-react";

interface ConnectionSafe {
  organizationId: string;
  organizationName: string | null;
  status: "active" | "disconnected";
  lastValidatedAt: string | null;
  updatedAt: string;
}

interface FundrazrCampaign {
  id: string;
  title?: string;
  url?: string;
  image_url?: string;
  goal?: number;
  currency?: string;
  status?: string;
  campaign_type?: string;
  launched?: number;
  stats?: { total_raised?: number; contribution_count?: number };
}

function fmtMoney(cents: number | undefined, currency = "USD") {
  if (cents == null) return "—";
  // ConnectionPoint returns amounts in the smallest currency unit.
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function fmtDate(unixSec: number | undefined) {
  if (!unixSec) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
    new Date(unixSec * 1000),
  );
}

export default function FundrazrPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const [conn, setConn] = useState<ConnectionSafe | null | undefined>(undefined);
  const [orgIdInput, setOrgIdInput] = useState("");
  const [savingConn, setSavingConn] = useState(false);
  const [campaigns, setCampaigns] = useState<FundrazrCampaign[] | null>(null);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [campaignError, setCampaignError] = useState<string | null>(null);

  const loadConnection = useCallback(async () => {
    const res = await fetch("/api/admin/fundrazr/connect", {
      cache: "no-store",
    });
    if (!res.ok) {
      setConn(null);
      return;
    }
    const body = (await res.json()) as { connection: ConnectionSafe | null };
    setConn(body.connection);
    if (body.connection?.organizationId) {
      setOrgIdInput(body.connection.organizationId);
    }
  }, []);

  const loadCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    setCampaignError(null);
    try {
      const res = await fetch("/api/admin/fundrazr/campaigns", {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        if (res.status !== 409) {
          setCampaignError(
            body?.message ?? `Failed to load campaigns (HTTP ${res.status}).`,
          );
        }
        setCampaigns(null);
        return;
      }
      setCampaigns(body.campaigns ?? []);
    } catch (err) {
      setCampaignError(err instanceof Error ? err.message : String(err));
      setCampaigns(null);
    } finally {
      setLoadingCampaigns(false);
    }
  }, []);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session) {
      router.push("/auth/login");
      return;
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      router.push("/contacts");
      return;
    }
    void loadConnection();
  }, [router, session, sessionStatus, loadConnection]);

  useEffect(() => {
    if (conn?.status === "active") void loadCampaigns();
    else setCampaigns(null);
  }, [conn?.status, conn?.organizationId, loadCampaigns]);

  async function handleSaveOrgId() {
    const trimmed = orgIdInput.trim();
    if (!trimmed) {
      toast.error("Enter your FundRazr organization ID.");
      return;
    }
    setSavingConn(true);
    try {
      const res = await fetch("/api/admin/fundrazr/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: trimmed }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(
          body?.message ?? `Failed to save (HTTP ${res.status}).`,
        );
        return;
      }
      setConn(body.connection);
      toast.success("Connected to FundRazr.");
    } finally {
      setSavingConn(false);
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect FundRazr? Campaigns will stop showing until you reconnect.")) return;
    setSavingConn(true);
    try {
      const res = await fetch("/api/admin/fundrazr/connect", {
        method: "DELETE",
      });
      if (!res.ok) {
        toast.error(`Failed to disconnect (HTTP ${res.status}).`);
        return;
      }
      await loadConnection();
      toast.success("Disconnected.");
    } finally {
      setSavingConn(false);
    }
  }

  const totalRaised = useMemo(() => {
    if (!campaigns) return 0;
    return campaigns.reduce(
      (sum, c) => sum + (c.stats?.total_raised ?? 0),
      0,
    );
  }, [campaigns]);

  const totalContributors = useMemo(() => {
    if (!campaigns) return 0;
    return campaigns.reduce(
      (sum, c) => sum + (c.stats?.contribution_count ?? 0),
      0,
    );
  }, [campaigns]);

  if (conn === undefined) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading FundRazr…
      </div>
    );
  }

  const isConnected = conn?.status === "active";

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <header className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-emerald-100 text-emerald-700">
          <Megaphone className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">FundRazr Campaigns</h1>
          <p className="text-sm text-muted-foreground">
            Live view of your FundRazr organization&apos;s campaigns.
            Read-only — nothing here changes anything on FundRazr.
          </p>
        </div>
      </header>

      {/* Connection card */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">Connection</div>
              <div className="text-xs text-muted-foreground">
                Paste your ConnectionPoint / FundRazr organization ID. We
                validate it against FundRazr before saving.
              </div>
            </div>
            {isConnected && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Connected
                {conn?.organizationName ? ` · ${conn.organizationName}` : ""}
              </span>
            )}
          </div>

          <div className="flex flex-col md:flex-row gap-2">
            <Input
              value={orgIdInput}
              onChange={(e) => setOrgIdInput(e.target.value)}
              placeholder="e.g. org_abc123 or your FundRazr org UUID"
              className="font-mono text-sm"
              disabled={savingConn}
            />
            <Button
              onClick={handleSaveOrgId}
              disabled={savingConn || !orgIdInput.trim()}
              className="gap-2"
            >
              {savingConn ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {isConnected ? "Update" : "Connect"}
            </Button>
            {isConnected && (
              <Button
                variant="outline"
                onClick={handleDisconnect}
                disabled={savingConn}
                className="gap-2"
              >
                <Unplug className="h-4 w-4" />
                Disconnect
              </Button>
            )}
          </div>

          {conn?.lastValidatedAt && (
            <div className="text-xs text-muted-foreground">
              Last validated {new Date(conn.lastValidatedAt).toLocaleString()}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Campaigns */}
      {isConnected && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium">Campaigns</div>
                <div className="text-xs text-muted-foreground">
                  {campaigns
                    ? `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} · ${fmtMoney(
                        totalRaised,
                      )} raised · ${totalContributors} contributors`
                    : "Fetching…"}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadCampaigns()}
                disabled={loadingCampaigns}
                className="gap-2"
              >
                {loadingCampaigns ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh
              </Button>
            </div>

            {campaignError && (
              <div className="rounded-md border border-red-200 bg-red-50 text-red-800 text-sm p-3">
                {campaignError}
              </div>
            )}

            {loadingCampaigns && !campaigns && (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading campaigns from FundRazr…
              </div>
            )}

            {campaigns && campaigns.length === 0 && !loadingCampaigns && (
              <div className="text-sm text-muted-foreground py-8 text-center">
                No campaigns found for this organization.
              </div>
            )}

            {campaigns && campaigns.length > 0 && (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2">Campaign</th>
                      <th className="text-left px-3 py-2">Status</th>
                      <th className="text-right px-3 py-2">Goal</th>
                      <th className="text-right px-3 py-2">Raised</th>
                      <th className="text-right px-3 py-2">Contributors</th>
                      <th className="text-left px-3 py-2">Launched</th>
                      <th className="text-right px-3 py-2">Open</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaigns.map((c) => (
                      <tr key={c.id} className="border-t">
                        <td className="px-3 py-2 font-medium">
                          {c.title ?? c.id}
                        </td>
                        <td className="px-3 py-2 capitalize">
                          {c.status ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {fmtMoney(c.goal, c.currency)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {fmtMoney(c.stats?.total_raised, c.currency)}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {c.stats?.contribution_count ?? 0}
                        </td>
                        <td className="px-3 py-2">{fmtDate(c.launched)}</td>
                        <td className="px-3 py-2 text-right">
                          {c.url ? (
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                            >
                              View
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!isConnected && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Save your organization ID above to see live campaigns.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
