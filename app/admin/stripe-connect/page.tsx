"use client";

/**
 * /admin/stripe-connect — connection status hub.
 *
 * Shows the tenant's Stripe connection status with Connect / Reconnect /
 * Disconnect actions. This is Settings-only — the Fundraising Campaigns
 * wizard reads this connection when "Stripe" is picked as the processor.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertTriangle, XCircle, Plug, Loader2 } from "lucide-react";

interface ConnectionSafe {
  id: string;
  publishableKey: string;
  accountId: string | null;
  accountName: string | null;
  mode: "test" | "live";
  status: "active" | "needs_reconnect" | "revoked";
  lastValidatedAt: string | null;
  createdAt: string;
  webhookRegistered: boolean;
  webhookRegistrationError: string | null;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function webhookErrorMessage(reason: string | null): string {
  if (reason === "app_url_not_https") {
    return "Your app isn't reachable over HTTPS yet, so Stripe won't deliver webhooks here. Donations can still be started, but they won't be confirmed automatically until the app is on a public HTTPS URL (or you use a tool like ngrok / stripe listen for local testing) — then reconnect to retry.";
  }
  return reason
    ? `Stripe rejected the webhook setup: ${reason}. Reconnect to retry.`
    : "Webhook setup hasn't completed yet. Reconnect to retry.";
}

export default function StripeConnectHubPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [conn, setConn] = useState<ConnectionSafe | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
      return;
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      router.push("/contacts");
      return;
    }
    void load();
  }, [router, session, status]);

  async function load() {
    try {
      const res = await fetch("/api/admin/stripe-connect/connection", { cache: "no-store" });
      if (res.ok) {
        const b = await res.json();
        setConn(b.connection ?? null);
      } else {
        setConn(null);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    }
  }

  async function handleDisconnect() {
    if (!confirm("Disconnect Stripe? Campaigns using Stripe will stop accepting donations. You can reconnect anytime.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/stripe-connect/connection", { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || `HTTP ${res.status}`);
      toast.success("Stripe disconnected");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (status === "loading" || conn === undefined || !session) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading Stripe…
      </div>
    );
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">Stripe</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect your Stripe account so Fundraising Campaigns can collect donations directly into it.
        </p>
      </header>

      {!conn || conn.status !== "active" ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                {conn?.status === "needs_reconnect" ? <AlertTriangle className="h-5 w-5" /> : <Plug className="h-5 w-5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-amber-900">
                  {!conn ? "Connect your Stripe account" : conn.status === "needs_reconnect" ? "Stripe needs to be reconnected" : "Stripe is disconnected"}
                </h2>
                <p className="mt-0.5 text-sm text-amber-900/85">
                  Paste your Stripe publishable + secret keys from Stripe → Developers → API keys. We encrypt the secret key before storing it.
                </p>
              </div>
            </div>
            <Button asChild className="bg-amber-700 hover:bg-amber-800">
              <Link href="/admin/stripe-connect/connect">
                <Plug className="mr-2 h-4 w-4" />
                {conn ? "Reconnect" : "Connect Stripe"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="border-emerald-200 bg-emerald-50/40">
            <CardContent className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-700" />
                  <div>
                    <h2 className="text-base font-semibold text-emerald-900">
                      Connected to {conn.accountName ?? conn.accountId}
                    </h2>
                    <p className="mt-0.5 text-xs text-emerald-800/80">
                      {conn.mode === "test" ? "Test mode" : "Live mode"} · validated {fmtDate(conn.lastValidatedAt)}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={handleDisconnect} disabled={busy}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                  Disconnect
                </Button>
              </div>
            </CardContent>
          </Card>

          {conn.webhookRegistered ? (
            <Card className="mt-3 border-emerald-200 bg-emerald-50/40">
              <CardContent className="flex items-center gap-2 px-5 py-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                <p className="text-sm text-emerald-900">
                  Webhook connected — Stripe donations confirm automatically.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="mt-3 border-amber-200 bg-amber-50/40">
              <CardContent className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <div className="flex min-w-0 flex-1 items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
                  <p className="text-sm text-amber-900">{webhookErrorMessage(conn.webhookRegistrationError)}</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/admin/stripe-connect/connect">Reconnect</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
