"use client";

/**
 * Create/edit form for a fundraising campaign. Money is collected through a
 * linked Crowded donation form (dropdown), so the campaign page reuses the
 * whole Crowded payment pipeline.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Save } from "lucide-react";

export type CampaignInitial = {
  id?: number;
  title?: string;
  story?: string | null;
  goalCents?: number | null;
  coverImageUrl?: string | null;
  primaryColor?: string | null;
  status?: string;
  crowdedFormId?: number | null;
  parentCampaignId?: number | null;
  ghlTag?: string | null;
  teamEnabled?: boolean;
  ownerName?: string | null;
  processor?: string;
};

export default function CampaignForm({ mode, initial }: { mode: "create" | "edit"; initial?: CampaignInitial }) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [goal, setGoal] = useState(initial?.goalCents != null ? String(initial.goalCents / 100) : "");
  const [crowdedFormId, setCrowdedFormId] = useState<string>(initial?.crowdedFormId != null ? String(initial.crowdedFormId) : "");
  const [coverImageUrl, setCoverImageUrl] = useState(initial?.coverImageUrl ?? "");
  const [primaryColor, setPrimaryColor] = useState(initial?.primaryColor ?? "#16A34A");
  const [story, setStory] = useState(initial?.story ?? "");
  const [status, setStatus] = useState(initial?.status ?? "active");
  const [ghlTag, setGhlTag] = useState(initial?.ghlTag ?? "");
  const [parentCampaignId, setParentCampaignId] = useState<string>(initial?.parentCampaignId != null ? String(initial.parentCampaignId) : "");
  const [teamEnabled, setTeamEnabled] = useState<boolean>(initial?.teamEnabled ?? false);
  const [ownerName, setOwnerName] = useState(initial?.ownerName ?? "");
  const [processor, setProcessor] = useState(initial?.processor ?? "crowded");
  const [forms, setForms] = useState<{ id: number; name: string }[]>([]);
  const [campaigns, setCampaigns] = useState<{ id: number; title: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/crowded/forms", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { forms: [] }))
      .then((b) => setForms((b.forms ?? []).map((f: { id: number; name: string }) => ({ id: f.id, name: f.name }))))
      .catch(() => {});
    // Top-level campaigns available as a parent (for sub-campaigns / P2P).
    fetch("/api/admin/fundraising", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { campaigns: [] }))
      .then((b) =>
        setCampaigns(
          (b.campaigns ?? [])
            .filter((c: { id: number; parentCampaignId: number | null }) => c.parentCampaignId == null && c.id !== initial?.id)
            .map((c: { id: number; title: string }) => ({ id: c.id, title: c.title })),
        ),
      )
      .catch(() => {});
  }, [initial?.id]);

  async function save() {
    setSaving(true);
    setError(null);
    const payload = {
      title: title.trim(),
      goalCents: goal.trim() ? Math.round(parseFloat(goal) * 100) : null,
      crowdedFormId: crowdedFormId ? Number(crowdedFormId) : null,
      coverImageUrl: coverImageUrl.trim() || null,
      primaryColor,
      story: story.trim() || null,
      status,
      ghlTag: ghlTag.trim() || null,
      parentCampaignId: parentCampaignId ? Number(parentCampaignId) : null,
      teamEnabled,
      ownerName: ownerName.trim() || null,
      processor,
    };
    try {
      const res = await fetch(mode === "create" ? "/api/admin/fundraising" : `/api/admin/fundraising/${initial?.id}`, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const b = await res.json();
      if (!res.ok) {
        setError(b.details?.[0]?.message || b.error || "Failed to save");
        return;
      }
      router.push(mode === "create" ? `/admin/fundraising/${b.campaign.id}` : "/admin/fundraising");
      router.refresh();
    } catch {
      setError("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="p-6">
      <div className="space-y-5">
        {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        <Field label="Campaign title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Summer 2026 Appeal" className="h-11" />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Fundraising goal (USD)" hint="Optional — shows a progress bar">
            <Input value={goal} onChange={(e) => setGoal(e.target.value)} inputMode="decimal" placeholder="10000" className="h-11" />
          </Field>
          <Field label="Brand color">
            <div className="flex items-center gap-2">
              <input type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-11 w-14 rounded border" />
              <Input value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-11" />
            </div>
          </Field>
        </div>

        <Field label="Donation form (collects the money)" hint="Reuses your Crowded donation forms. Create one under Donation Forms first if the list is empty.">
          <select value={crowdedFormId} onChange={(e) => setCrowdedFormId(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3 text-sm">
            <option value="">— None (page shows “not open yet”) —</option>
            {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>

        <Field label="Cover image URL" hint="Optional">
          <Input value={coverImageUrl} onChange={(e) => setCoverImageUrl(e.target.value)} placeholder="https://…/cover.jpg" className="h-11" />
        </Field>

        <Field label="Story">
          <textarea value={story} onChange={(e) => setStory(e.target.value)} rows={6} placeholder="Tell donors why this matters…" className="w-full rounded-md border bg-background p-3 text-sm" />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Sub-campaign of" hint="Optional — nest this under a parent campaign (sub-campaign / team page)">
            <select value={parentCampaignId} onChange={(e) => setParentCampaignId(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3 text-sm">
              <option value="">— Top-level campaign —</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </Field>
          <Field label="GHL tag on donation" hint="Optional — tag applied to the donor's GHL contact when they give">
            <Input value={ghlTag} onChange={(e) => setGhlTag(e.target.value)} placeholder="Summer 2026" className="h-11" />
          </Field>
        </div>

        <div className="rounded-lg border p-4">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={teamEnabled} onChange={(e) => setTeamEnabled(e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
            Peer-to-peer team fundraising
          </label>
          <p className="mt-1 text-xs text-muted-foreground">Supporters run their own pages under this campaign; the parent page shows a team leaderboard.</p>
          {(teamEnabled || parentCampaignId) && (
            <div className="mt-3">
              <Field label="Fundraiser / team name" hint="Shown on this page (for a personal or team page)">
                <Input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="e.g. Team Goldberg" className="h-11" />
              </Field>
            </div>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3 text-sm">
              <option value="active">Active</option>
              <option value="draft">Draft (hidden)</option>
              <option value="ended">Ended</option>
            </select>
          </Field>
          <Field label="Payment processor" hint="Collects donations for this campaign. More processors coming soon.">
            <select value={processor} onChange={(e) => setProcessor(e.target.value)} className="h-11 w-full rounded-md border bg-background px-3 text-sm">
              <option value="crowded">Crowded (default)</option>
            </select>
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => router.push("/admin/fundraising")}>Cancel</Button>
          <Button onClick={save} disabled={saving || !title.trim()} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === "create" ? "Create campaign" : "Save changes"}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">
        {label}{required && <span className="text-red-500"> *</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
