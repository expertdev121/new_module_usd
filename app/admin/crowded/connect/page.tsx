"use client";

/**
 * /admin/crowded/connect — two-step connect flow.
 *
 *   Step 1: paste API key → POST /chapters → if it returns chapters, show picker
 *   Step 2: pick chapter → POST /connect → persists encrypted + registers webhook
 *
 * The token field is treated as a credential — autocomplete=off, never
 * logged client-side, immediately replaced with a masked display once
 * the connection is saved.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, ArrowRight, ExternalLink } from "lucide-react";

interface Chapter {
  id: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
}

export default function ConnectCrowdedPage() {
  const router = useRouter();
  const [apiToken, setApiToken] = useState("");
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  async function handleValidate(e: React.FormEvent) {
    e.preventDefault();
    if (!apiToken.trim()) return;
    setSubmitting(true);
    setWarning(null);
    try {
      const res = await fetch("/api/admin/crowded/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiToken: apiToken.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { message?: string }).message ?? `HTTP ${res.status}`,
        );
      }
      const list = (body as { chapters: Chapter[] }).chapters;
      if (list.length === 0) {
        toast.error("Token works but no chapters were returned.");
        return;
      }
      setChapters(list);
      setSelected(list[0].id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to validate");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSave() {
    if (!selected || !apiToken.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/crowded/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiToken: apiToken.trim(),
          chapterId: selected,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { message?: string }).message ?? `HTTP ${res.status}`,
        );
      }
      const w = (body as { warning?: string | null }).warning;
      if (w) {
        setWarning(w);
        toast.message("Connected with a warning", { description: w });
      } else {
        toast.success("Crowded connected");
      }
      router.push("/admin/crowded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">
          Connect Crowded
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Securely link your Crowded chapter so DonorHQ can create forms and
          receive donation events.
        </p>
      </header>

      <Card className="max-w-2xl">
        <CardContent className="px-6 py-6">
          {chapters === null ? (
            <form onSubmit={handleValidate} className="space-y-4">
              <div>
                <label className="text-sm font-medium" htmlFor="token">
                  Crowded Partner API key
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Find it in Crowded → Settings → API. Looks like a long
                  random string. We encrypt it before storing.
                </p>
                <Input
                  id="token"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="••••••••••••••••••••••"
                  value={apiToken}
                  onChange={(e) => setApiToken(e.target.value)}
                  className="mt-2 font-mono"
                  required
                />
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={submitting || !apiToken.trim()}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Validating…
                    </>
                  ) : (
                    <>
                      Validate token
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </>
                  )}
                </Button>
                <a
                  href="https://www.bankingcrowded.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  Need a Crowded account?
                </a>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium">
                  Pick the chapter to receive donations
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  All donations from forms in DonorHQ will settle into this
                  Crowded chapter.
                </p>
              </div>
              <div className="space-y-2">
                {chapters.map((c) => (
                  <label
                    key={c.id}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${
                      selected === c.id
                        ? "border-emerald-500 bg-emerald-50/40"
                        : "border-border"
                    }`}
                  >
                    <input
                      type="radio"
                      name="chapter"
                      value={c.id}
                      checked={selected === c.id}
                      onChange={() => setSelected(c.id)}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {c.organizationName ? `${c.organizationName} · ` : ""}
                        <span className="font-mono">{c.id}</span>
                      </div>
                    </div>
                  </label>
                ))}
              </div>
              {warning && (
                <Alert>
                  <AlertDescription className="text-xs">{warning}</AlertDescription>
                </Alert>
              )}
              <div className="flex items-center gap-2">
                <Button onClick={handleSave} disabled={submitting || !selected}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save connection"
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setChapters(null);
                    setSelected(null);
                  }}
                  disabled={submitting}
                >
                  Use a different token
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
