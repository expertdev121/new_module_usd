"use client";

/**
 * /admin/households/:id — one family view.
 * Shows household header + members list + household-level payments.
 * Editable via the "Edit" button (posts back to /api/admin/households/:id).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Home, Loader2, Save, User } from "lucide-react";

interface Household {
  id: number;
  displayName: string;
  externalId: string | null;
  membershipTier: string | null;
  mailLabel: string | null;
  mailAddress1: string | null;
  mailAddress2: string | null;
  mailCity: string | null;
  mailState: string | null;
  mailZip: string | null;
  mailCountry: string | null;
  householdPhone: string | null;
  householdEmail: string | null;
  notes: string | null;
}

interface Member {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string | null;
  phone: string | null;
  isPrimaryContact: boolean | null;
  relationship: string | null;
}

interface Payment {
  id: number;
  source: "payment" | "manual_donation";
  amount: string;
  currency: string;
  paymentDate: string;
  paymentMethod: string | null;
  paymentStatus: string;
  notes: string | null;
  importSource: string | null;
  contactId: number | null;
}

export default function HouseholdDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [household, setHousehold] = useState<Household | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Partial<Household>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/households/${id}`, { cache: "no-store" });
    if (res.status === 404) return router.push("/admin/households");
    if (!res.ok) {
      toast.error(`Failed to load (HTTP ${res.status})`);
      return;
    }
    const body = await res.json();
    setHousehold(body.household);
    setMembers(body.members ?? []);
    setPayments(body.payments ?? []);
    setDraft(body.household);
  }, [id, router]);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) return void router.push("/auth/login");
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      router.push("/contacts");
      return;
    }
    void load();
  }, [router, session, status, load]);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/households/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        toast.error(`Save failed (HTTP ${res.status})`);
        return;
      }
      const body = await res.json();
      setHousehold(body.household);
      setDraft(body.household);
      setEditing(false);
      toast.success("Saved.");
    } finally {
      setSaving(false);
    }
  }

  if (!household) {
    return (
      <div className="p-8 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading household…
      </div>
    );
  }

  const totalGiven = payments.reduce(
    (s, p) => s + (parseFloat(p.amount) || 0),
    0,
  );

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <Link
          href="/admin/households"
          className="text-sm text-muted-foreground hover:underline inline-flex items-center gap-1"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All households
        </Link>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700">
                <Home className="h-5 w-5" />
              </div>
              <div>
                {editing ? (
                  <Input
                    className="text-lg font-semibold"
                    value={draft.displayName ?? ""}
                    onChange={(e) =>
                      setDraft({ ...draft, displayName: e.target.value })
                    }
                  />
                ) : (
                  <h1 className="text-xl font-semibold">
                    {household.displayName}
                  </h1>
                )}
                <p className="text-sm text-muted-foreground">
                  {household.membershipTier ?? "No tier"}
                  {household.externalId ? ` · ${household.externalId}` : ""}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <Button variant="outline" onClick={() => { setEditing(false); setDraft(household); }}>
                    Cancel
                  </Button>
                  <Button onClick={save} disabled={saving} className="gap-2">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save
                  </Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 grid md:grid-cols-2 gap-4 text-sm">
            <Field label="Mail label" value={household.mailLabel} editing={editing} onChange={(v) => setDraft({ ...draft, mailLabel: v })} draftValue={draft.mailLabel ?? ""} />
            <Field label="Membership tier" value={household.membershipTier} editing={editing} onChange={(v) => setDraft({ ...draft, membershipTier: v })} draftValue={draft.membershipTier ?? ""} />
            <Field label="Address 1" value={household.mailAddress1} editing={editing} onChange={(v) => setDraft({ ...draft, mailAddress1: v })} draftValue={draft.mailAddress1 ?? ""} />
            <Field label="Address 2" value={household.mailAddress2} editing={editing} onChange={(v) => setDraft({ ...draft, mailAddress2: v })} draftValue={draft.mailAddress2 ?? ""} />
            <Field label="City" value={household.mailCity} editing={editing} onChange={(v) => setDraft({ ...draft, mailCity: v })} draftValue={draft.mailCity ?? ""} />
            <Field label="State" value={household.mailState} editing={editing} onChange={(v) => setDraft({ ...draft, mailState: v })} draftValue={draft.mailState ?? ""} />
            <Field label="Zip" value={household.mailZip} editing={editing} onChange={(v) => setDraft({ ...draft, mailZip: v })} draftValue={draft.mailZip ?? ""} />
            <Field label="Country" value={household.mailCountry} editing={editing} onChange={(v) => setDraft({ ...draft, mailCountry: v })} draftValue={draft.mailCountry ?? ""} />
            <Field label="Household phone" value={household.householdPhone} editing={editing} onChange={(v) => setDraft({ ...draft, householdPhone: v })} draftValue={draft.householdPhone ?? ""} />
            <Field label="Household email" value={household.householdEmail} editing={editing} onChange={(v) => setDraft({ ...draft, householdEmail: v })} draftValue={draft.householdEmail ?? ""} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="text-sm font-medium mb-2">
            Members ({members.length})
          </div>
          {members.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No members yet. Attach a contact to this household from the contact&apos;s edit page.
            </div>
          ) : (
            <div className="divide-y">
              {members.map((m) => (
                <div key={m.id} className="py-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <Link href={`/contacts/${m.id}`} className="font-medium hover:underline">
                      {m.displayName ?? `${m.firstName} ${m.lastName}`.trim()}
                    </Link>
                    {m.isPrimaryContact && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800">
                        Primary
                      </span>
                    )}
                    {m.relationship && (
                      <span className="text-xs text-muted-foreground">
                        · {m.relationship}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {m.email ?? m.phone ?? ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-sm font-medium">
              Household donations ({payments.length})
            </div>
            <div className="text-sm text-muted-foreground">
              Total{" "}
              <span className="font-semibold text-foreground">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(totalGiven)}
              </span>
            </div>
          </div>
          {payments.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No household-level donations yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-1.5">Date</th>
                    <th className="text-right px-3 py-1.5">Amount</th>
                    <th className="text-left px-3 py-1.5">Method</th>
                    <th className="text-left px-3 py-1.5">Status</th>
                    <th className="text-left px-3 py-1.5">Source</th>
                    <th className="text-left px-3 py-1.5">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={`${p.source}-${p.id}`} className="border-t">
                      <td className="px-3 py-1.5">{p.paymentDate}</td>
                      <td className="px-3 py-1.5 text-right">
                        {new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency || "USD" }).format(parseFloat(p.amount))}
                      </td>
                      <td className="px-3 py-1.5">{p.paymentMethod ?? "—"}</td>
                      <td className="px-3 py-1.5 capitalize">{p.paymentStatus}</td>
                      <td className="px-3 py-1.5">
                        <span className="text-xs text-muted-foreground">
                          {p.importSource ?? p.source}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-muted-foreground truncate max-w-xs">
                        {p.notes ?? ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  value,
  editing,
  draftValue,
  onChange,
}: {
  label: string;
  value: string | null;
  editing: boolean;
  draftValue: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      {editing ? (
        <Input value={draftValue} onChange={(e) => onChange(e.target.value)} className="mt-1" />
      ) : (
        <div className="mt-1">{value ?? <span className="text-muted-foreground">—</span>}</div>
      )}
    </div>
  );
}
