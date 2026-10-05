"use client";

/**
 * /admin/stripe-connect/connect — one-step connect flow.
 *
 * Paste publishable + secret key → POST /connect validates against Stripe's
 * /v1/account and persists (secret encrypted). No chapter-style picker
 * needed — a Stripe key pair already scopes to exactly one account.
 *
 * The secret key field is treated as a credential — autocomplete=off,
 * never logged client-side.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ArrowRight, ExternalLink, CircleDollarSign } from "lucide-react";

export default function ConnectStripePage() {
  const router = useRouter();
  const [publishableKey, setPublishableKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!publishableKey.trim() || !secretKey.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/stripe-connect/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publishableKey: publishableKey.trim(), secretKey: secretKey.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { message?: string }).message ?? `HTTP ${res.status}`);
      }
      toast.success("Stripe connected");
      router.push("/admin/stripe-connect");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card className="overflow-hidden">
        <div className="flex items-start gap-3 border-b bg-muted/30 px-6 py-5">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-indigo-100 text-indigo-700">
            <CircleDollarSign className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Connect Stripe</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Securely link your Stripe account so DonorHQ can collect campaign donations into it.
            </p>
          </div>
        </div>
        <CardContent className="px-6 py-6">
          <form onSubmit={handleSave} className="space-y-4">
            <div>
              <label className="text-sm font-medium" htmlFor="publishableKey">
                Publishable key
              </label>
              <p className="mt-1 text-xs text-muted-foreground">Starts with pk_test_ or pk_live_. Safe to show — not a secret.</p>
              <Input
                id="publishableKey"
                autoComplete="off"
                spellCheck={false}
                placeholder="pk_test_..."
                value={publishableKey}
                onChange={(e) => setPublishableKey(e.target.value)}
                className="mt-2 font-mono"
                required
              />
            </div>
            <div>
              <label className="text-sm font-medium" htmlFor="secretKey">
                Secret key
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Starts with sk_test_ or sk_live_. Find both in Stripe → Developers → API keys. We encrypt this before storing.
              </p>
              <Input
                id="secretKey"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="••••••••••••••••••••••"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="mt-2 font-mono"
                required
              />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={submitting || !publishableKey.trim() || !secretKey.trim()}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting…
                  </>
                ) : (
                  <>
                    Connect Stripe
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
              <a
                href="https://dashboard.stripe.com/apikeys"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
              >
                <ExternalLink className="mr-1 h-3 w-3" />
                Find your API keys
              </a>
            </div>

            {error && (
              <Alert variant="destructive" className="mt-2">
                <AlertDescription className="text-xs">{error}</AlertDescription>
              </Alert>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
