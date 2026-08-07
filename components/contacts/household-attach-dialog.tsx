"use client";

/**
 * Modal to attach a contact to a household.
 *
 * Search box drives a debounced /api/admin/households/search query
 * (2,230+ families in some tenants, so no full dropdown).
 * Once a household is picked, the operator chooses a relationship
 * from a fixed set. "primary" auto-demotes any existing primary in
 * that household on save.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Home, Loader2, Search } from "lucide-react";

interface HouseholdHit {
  id: number;
  displayName: string;
  externalId: string | null;
  membershipTier: string | null;
  mailCity: string | null;
  mailState: string | null;
  memberCount: number;
}

type Relationship = "primary" | "spouse" | "child" | "family" | "other";

export function HouseholdAttachDialog({
  contactId,
  open,
  onOpenChange,
  onAttached,
}: {
  contactId: number;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAttached: (payload: { householdId: number; householdName: string; relationship: Relationship; isPrimary: boolean }) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<HouseholdHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<HouseholdHit | null>(null);
  const [relationship, setRelationship] = useState<Relationship>("family");
  const [setPrimary, setSetPrimary] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<number | null>(null);

  // Reset state whenever the dialog opens.
  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults([]);
    setPicked(null);
    setRelationship("family");
    setSetPrimary(false);
  }, [open]);

  const search = useCallback(async (query: string) => {
    setLoading(true);
    try {
      const url = new URL("/api/admin/households/search", window.location.origin);
      if (query) url.searchParams.set("q", query);
      url.searchParams.set("limit", "20");
      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        setResults([]);
        return;
      }
      const body = await res.json();
      setResults(body.households ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounced search on each keystroke; also load initial results on open.
  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void search(q), 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [q, open, search]);

  async function attach() {
    if (!picked) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/contacts/${contactId}/household`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          householdId: picked.id,
          relationship,
          setPrimary: setPrimary || relationship === "primary",
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body?.message ?? `Failed to attach (HTTP ${res.status})`);
        return;
      }
      toast.success(`Attached to ${picked.displayName}.`);
      onAttached({
        householdId: picked.id,
        householdName: picked.displayName,
        relationship,
        isPrimary: setPrimary || relationship === "primary",
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Home className="h-4 w-4" /> Attach to household
          </DialogTitle>
          <DialogDescription>
            Search by family name or external id. Once selected, choose this
            contact&apos;s relationship inside the family.
          </DialogDescription>
        </DialogHeader>

        {!picked ? (
          <div className="space-y-3">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search families…"
                className="pl-9"
              />
            </div>
            <div className="max-h-72 overflow-y-auto border rounded-md">
              {loading && !results.length ? (
                <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching…
                </div>
              ) : results.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">
                  {q ? "No matches." : "Start typing to search."}
                </div>
              ) : (
                <ul className="divide-y">
                  {results.map((h) => (
                    <li key={h.id}>
                      <button
                        type="button"
                        onClick={() => setPicked(h)}
                        className="w-full text-left px-3 py-2 hover:bg-muted/40 focus:bg-muted/40"
                      >
                        <div className="font-medium">{h.displayName}</div>
                        <div className="text-xs text-muted-foreground flex gap-2 flex-wrap">
                          {h.externalId && <span className="font-mono">{h.externalId}</span>}
                          {h.membershipTier && <span>· {h.membershipTier}</span>}
                          {(h.mailCity || h.mailState) && (
                            <span>· {[h.mailCity, h.mailState].filter(Boolean).join(", ")}</span>
                          )}
                          <span>· {h.memberCount} member{h.memberCount === 1 ? "" : "s"}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border p-3 bg-muted/20">
              <div className="text-xs uppercase text-muted-foreground">Household</div>
              <div className="font-medium">{picked.displayName}</div>
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="text-xs text-blue-600 hover:underline mt-1"
              >
                ← pick a different one
              </button>
            </div>
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Relationship
              </div>
              <Select value={relationship} onValueChange={(v) => setRelationship(v as Relationship)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Primary contact</SelectItem>
                  <SelectItem value="spouse">Spouse</SelectItem>
                  <SelectItem value="child">Child</SelectItem>
                  <SelectItem value="family">Family member</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground mt-1">
                {relationship === "primary"
                  ? "Choosing Primary will demote any existing primary contact of this household."
                  : "Only one primary contact per household. Change existing primary from the household detail page if needed."}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={attach} disabled={!picked || saving} className="gap-2">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Attach
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
