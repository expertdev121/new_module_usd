"use client";

/**
 * /admin/households/new — create a new household.
 * Only display_name is required by the API; everything else is optional.
 * On success we redirect to /admin/households/[id] so the operator can
 * immediately attach members.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Home, Loader2, Save } from "lucide-react";

interface FormState {
  displayName: string;
  externalId: string;
  membershipTier: string;
  mailLabel: string;
  mailAddress1: string;
  mailAddress2: string;
  mailCity: string;
  mailState: string;
  mailZip: string;
  mailCountry: string;
  householdPhone: string;
  householdEmail: string;
  notes: string;
}

const EMPTY: FormState = {
  displayName: "",
  externalId: "",
  membershipTier: "",
  mailLabel: "",
  mailAddress1: "",
  mailAddress2: "",
  mailCity: "",
  mailState: "",
  mailZip: "",
  mailCountry: "",
  householdPhone: "",
  householdEmail: "",
  notes: "",
};

export default function NewHouseholdPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [mode, setMode] = useState<"individual" | "household" | undefined>(
    undefined,
  );
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) return void router.push("/auth/login");
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      router.push("/contacts");
      return;
    }
    fetch("/api/admin/location-settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { accountType: "individual" }))
      .then((b) => setMode(b.accountType ?? "individual"));
  }, [router, session, status]);

  async function submit() {
    setErrorMsg(null);
    const displayName = form.displayName.trim();
    if (!displayName) {
      setErrorMsg("Family name is required.");
      return;
    }
    setSaving(true);
    try {
      // Build the payload — send only fields with values so we don't
      // overwrite defaults with empty strings.
      const payload: Record<string, string> = { displayName };
      for (const k of Object.keys(form) as Array<keyof FormState>) {
        if (k === "displayName") continue;
        const v = form[k]?.trim();
        if (v) payload[k] = v;
      }
      const res = await fetch("/api/admin/households", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      let body: { household?: { id: number }; error?: string; message?: string } = {};
      try {
        body = await res.json();
      } catch {
        // fall through — non-JSON error body
      }
      if (!res.ok || !body.household) {
        const msg =
          body.message ??
          body.error ??
          `Server returned HTTP ${res.status}. Check the server log.`;
        setErrorMsg(msg);
        toast.error(msg);
        return;
      }
      toast.success(`Created ${displayName}.`);
      router.push(`/admin/households/${body.household.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(`Network error: ${msg}`);
      toast.error(`Network error: ${msg}`);
    } finally {
      setSaving(false);
    }
  }

  if (mode === undefined) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  if (mode !== "household") {
    return (
      <div className="p-8 max-w-xl mx-auto text-sm text-muted-foreground">
        This location is not in household mode.{" "}
        <Link href="/admin/households" className="underline">
          Enable household mode
        </Link>{" "}
        first.
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto space-y-6">
      <div>
        <Link
          href="/admin/households"
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All households
        </Link>
      </div>

      <Card>
        <CardContent className="p-5 space-y-5">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
              <Home className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">New household</h1>
              <p className="text-sm text-muted-foreground">
                Create a family / billing unit. You can attach contacts to
                this household from any contact&apos;s edit page after.
              </p>
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-800 text-sm p-3">
              {errorMsg}
            </div>
          )}

          <Row
            label="Family name"
            required
            value={form.displayName}
            onChange={(v) => setForm({ ...form, displayName: v })}
            placeholder="The Sontag Family"
          />
          <Row
            label="Mail label"
            value={form.mailLabel}
            onChange={(v) => setForm({ ...form, mailLabel: v })}
            placeholder="Mr. & Mrs. Tzvi Sontag"
          />
          <Row
            label="Membership tier"
            value={form.membershipTier}
            onChange={(v) => setForm({ ...form, membershipTier: v })}
            placeholder="Full Member / Dinner Only / Associate…"
          />
          <div className="grid md:grid-cols-2 gap-3">
            <Row
              label="Address line 1"
              value={form.mailAddress1}
              onChange={(v) => setForm({ ...form, mailAddress1: v })}
            />
            <Row
              label="Address line 2"
              value={form.mailAddress2}
              onChange={(v) => setForm({ ...form, mailAddress2: v })}
            />
            <Row label="City" value={form.mailCity} onChange={(v) => setForm({ ...form, mailCity: v })} />
            <Row label="State" value={form.mailState} onChange={(v) => setForm({ ...form, mailState: v })} />
            <Row label="Zip" value={form.mailZip} onChange={(v) => setForm({ ...form, mailZip: v })} />
            <Row label="Country" value={form.mailCountry} onChange={(v) => setForm({ ...form, mailCountry: v })} />
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            <Row
              label="Household phone"
              value={form.householdPhone}
              onChange={(v) => setForm({ ...form, householdPhone: v })}
            />
            <Row
              label="Household email"
              value={form.householdEmail}
              onChange={(v) => setForm({ ...form, householdEmail: v })}
            />
          </div>
          <Row
            label="External ID"
            value={form.externalId}
            onChange={(v) => setForm({ ...form, externalId: v })}
            placeholder="Optional id from the source system"
          />
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">
              Notes
            </div>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={3}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => router.push("/admin/households")}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving || !form.displayName.trim()} className="gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Create household
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground mb-1">
        {label}
        {required ? <span className="text-red-500 ml-0.5">*</span> : null}
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
