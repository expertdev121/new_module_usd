"use client";

/**
 * /admin/fundraising/webhooks — self-serve outbound webhooks.
 *
 * A user registers a URL (typically a GHL inbound-webhook trigger). When a
 * fundraising donation completes, DonorHQ POSTs the donation payload to every
 * active matching webhook, so tenants can drive automations without support.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Webhook, Plus, Trash2, Loader2, ArrowLeft } from "lucide-react";

type Hook = {
  id: number;
  url: string;
  campaignId: number | null;
  event: string;
  isActive: boolean;
  lastFiredAt: string | null;
  lastStatus: number | null;
};

type Campaign = { id: number; title: string };

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function WebhooksPage() {
  const [hooks, setHooks] = useState<Hook[] | null>(null);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [url, setUrl] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/fundraising/webhooks", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((b) => setHooks(b.webhooks ?? []))
      .catch(() => setError("Failed to load webhooks"));
  }, []);

  useEffect(() => {
    load();
    fetch("/api/admin/fundraising", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((b) => setCampaigns((b.campaigns ?? []).map((c: { id: number; title: string }) => ({ id: c.id, title: c.title }))))
      .catch(() => {});
  }, [load]);

  async function add() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/fundraising/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), campaignId: campaignId ? Number(campaignId) : null }),
      });
      const b = await res.json();
      if (!res.ok) {
        setError(b.details?.[0]?.message || b.error || "Failed to add webhook");
        return;
      }
      setUrl("");
      setCampaignId("");
      load();
    } catch {
      setError("Failed to add webhook");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: number) {
    setHooks((prev) => (prev ? prev.filter((h) => h.id !== id) : prev));
    try {
      await fetch(`/api/admin/fundraising/webhooks/${id}`, { method: "DELETE" });
    } catch {
      load();
    }
  }

  const campaignName = (id: number | null) => (id == null ? "All campaigns" : campaigns.find((c) => c.id === id)?.title ?? `Campaign #${id}`);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-xl bg-indigo-100 text-indigo-700"><Webhook className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Donation webhooks</h1>
          <p className="text-sm text-muted-foreground">POST a donation payload to your own URL (e.g. a GHL inbound webhook) whenever a fundraising donation completes.</p>
        </div>
        <Button asChild variant="ghost" size="sm" className="gap-1.5"><Link href="/admin/fundraising"><ArrowLeft className="h-4 w-4" /> Campaigns</Link></Button>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="mb-1.5 block text-sm font-medium">Webhook URL</label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://services.leadconnectorhq.com/hooks/…" className="h-11" />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium">Scope</label>
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="h-11 w-56 rounded-md border bg-background px-3 text-sm">
              <option value="">All campaigns</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
          <Button onClick={add} disabled={saving || !url.trim()} className="h-11 gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add webhook
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">Payload: <code>{`{ event, campaignId, donationReference, amountUsd, status, contactId, donorEmail }`}</code></p>
      </Card>

      {!hooks ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : hooks.length === 0 ? (
        <Card className="p-10 text-center"><p className="text-sm text-muted-foreground">No webhooks yet.</p></Card>
      ) : (
        <div className="space-y-3">
          {hooks.map((h) => (
            <Card key={h.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-sm">{h.url}</span>
                    <Badge variant={h.isActive ? "default" : "secondary"}>{h.isActive ? "Active" : "Paused"}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {campaignName(h.campaignId)} · event <code>{h.event}</code> · last fired {fmt(h.lastFiredAt)}
                    {h.lastStatus != null && <> · HTTP {h.lastStatus}</>}
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="gap-1.5 text-red-600 hover:text-red-700" onClick={() => remove(h.id)}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
