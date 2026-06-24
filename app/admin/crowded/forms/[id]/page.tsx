"use client";

/**
 * /admin/crowded/forms/[id] — edit + embed.
 *
 * Top: tab-like switch between "Edit form" and "Embed code". Same data
 * row, different views. Embed code fetched fresh each time the panel
 * is opened.
 */
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Copy, ExternalLink, Check } from "lucide-react";
import { FormBuilder, type FormValues } from "../_components/form-builder";

interface Embed {
  formId: number;
  donateUrl: string;
  iframeSnippet: string;
  buttonSnippet: string;
}

export default function EditFormPage() {
  const { id } = useParams<{ id: string }>();
  const formId = parseInt(id!, 10);
  const [initial, setInitial] = useState<
    (Partial<FormValues> & { id?: number }) | null
  >(null);
  const [embed, setEmbed] = useState<Embed | null>(null);
  const [tab, setTab] = useState("edit");

  useEffect(() => {
    if (Number.isNaN(formId)) return;
    void (async () => {
      try {
        const res = await fetch(`/api/admin/crowded/forms/${formId}`, {
          cache: "no-store",
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }
        const f = (body as { form: Record<string, unknown> }).form;
        setInitial({
          id: formId,
          name: (f.name as string) ?? "",
          type: (f.type as "donation" | "dues") ?? "donation",
          amount: f.amountCents
            ? Math.round((f.amountCents as number) / 100)
            : null,
          goal: f.goalCents ? Math.round((f.goalCents as number) / 100) : null,
          recurringEnabled: Boolean(f.recurringEnabled),
          primaryColor: (f.primaryColor as string) ?? null,
          accentColor: (f.accentColor as string) ?? null,
          backgroundColor: (f.backgroundColor as string) ?? null,
          logoUrl: (f.logoUrl as string) ?? null,
          heroImageUrl: (f.heroImageUrl as string) ?? null,
          headline: (f.headline as string) ?? null,
          tagline: (f.tagline as string) ?? null,
          successMessage: (f.successMessage as string) ?? null,
          submitLabel: (f.submitLabel as string) ?? null,
          suggestedAmounts: (f.suggestedAmounts as number[] | null) ?? null,
          askAddress: Boolean(f.askAddress),
          askPhone: Boolean(f.askPhone),
          askTribute: Boolean(f.askTribute),
          askComments: Boolean(f.askComments),
          requireConsent: Boolean(f.requireConsent),
          feeCoverDefault:
            (f.feeCoverDefault as "donor" | "org") ?? "donor",
        });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load form");
      }
    })();
  }, [formId]);

  useEffect(() => {
    if (tab !== "embed" || Number.isNaN(formId) || embed) return;
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/crowded/forms/${formId}/embed`,
          { cache: "no-store" },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }
        setEmbed(body as Embed);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load embed");
      }
    })();
  }, [tab, formId, embed]);

  if (!initial) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-3xl font-semibold tracking-tight">
          {initial.name || "Edit form"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Edit the form details + branding, or grab the embed code to drop
          this form anywhere.
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4">
          <TabsTrigger value="edit">Edit form</TabsTrigger>
          <TabsTrigger value="embed">Embed code</TabsTrigger>
        </TabsList>
        <TabsContent value="edit">
          <FormBuilder mode="edit" initial={initial} />
        </TabsContent>
        <TabsContent value="embed">
          {embed ? (
            <EmbedPanel embed={embed} />
          ) : (
            <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading embed code…
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmbedPanel({ embed }: { embed: Embed }) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      toast.success(`${label} copied`);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error("Copy failed — select + copy manually");
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 px-5 py-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Direct link</h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy(embed.donateUrl, "Link")}
            >
              {copied === "Link" ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              Copy URL
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Share this URL anywhere donors can click — emails, SMS, Linktree.
          </p>
          <code className="block rounded-md border bg-muted px-3 py-2 font-mono text-xs">
            {embed.donateUrl}
          </code>
          <a
            href={embed.donateUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="mr-1 h-3 w-3" />
            Open in new tab
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Inline embed</h2>
              <p className="text-xs text-muted-foreground">
                Drop into any HTML page. Renders the full form inline.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy(embed.iframeSnippet, "Inline snippet")}
            >
              {copied === "Inline snippet" ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              Copy snippet
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted px-3 py-3 font-mono text-xs">
            {embed.iframeSnippet}
          </pre>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 px-5 py-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold">Button + popup</h2>
              <p className="text-xs text-muted-foreground">
                A single &lt;script&gt; tag that draws a styled button. On
                click, the form opens in a centred modal.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => copy(embed.buttonSnippet, "Button snippet")}
            >
              {copied === "Button snippet" ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              Copy snippet
            </Button>
          </div>
          <pre className="overflow-x-auto rounded-md border bg-muted px-3 py-3 font-mono text-xs">
            {embed.buttonSnippet}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
