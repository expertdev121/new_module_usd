"use client";

/**
 * Shared form builder used by both /forms/new and /forms/[id].
 *
 * Layout:
 *   - Left: editable fields grouped (Basics / Amount / Branding / Donor fields)
 *   - Right: a sticky live preview iframe that re-renders as the admin edits
 *
 * The preview iframe points at /donate/[id]?preview=1 for existing forms;
 * for new forms it shows a placeholder until the form is created.
 *
 * Branding fields:
 *   primary color (button + accents) / accent color (text + headings) /
 *   background color / logo URL / hero image URL / headline / tagline /
 *   suggested amount tiles / success message / button label
 */
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Save, ExternalLink } from "lucide-react";

export interface FormValues {
  name: string;
  type: "donation" | "dues";
  amount?: number | null;
  goal?: number | null;
  recurringEnabled: boolean;

  primaryColor?: string | null;
  accentColor?: string | null;
  backgroundColor?: string | null;
  logoUrl?: string | null;
  heroImageUrl?: string | null;
  headline?: string | null;
  tagline?: string | null;
  successMessage?: string | null;
  submitLabel?: string | null;
  suggestedAmounts?: number[] | null;

  askAddress: boolean;
  askPhone: boolean;
  askTribute: boolean;
  askComments: boolean;
  requireConsent: boolean;
  feeCoverDefault: "donor" | "org";
}

interface Props {
  initial?: Partial<FormValues> & { id?: number };
  mode: "create" | "edit";
}

const DEFAULT_VALUES: FormValues = {
  name: "",
  type: "donation",
  recurringEnabled: false,
  primaryColor: "#00A99D",
  accentColor: "#0F2A2E",
  backgroundColor: "#F5F2EC",
  headline: "",
  tagline: "",
  successMessage: "",
  submitLabel: "Donate Now",
  suggestedAmounts: [25, 50, 100, 250, 500, 1000],
  askAddress: true,
  askPhone: false,
  askTribute: false,
  askComments: false,
  requireConsent: true,
  feeCoverDefault: "donor",
};

export function FormBuilder({ initial, mode }: Props) {
  const router = useRouter();
  const [values, setValues] = useState<FormValues>({
    ...DEFAULT_VALUES,
    ...initial,
  } as FormValues);
  const [saving, setSaving] = useState(false);
  const formId = initial?.id ?? null;

  // Suggested amounts edited as a comma-separated string for UX.
  const [suggestedText, setSuggestedText] = useState<string>(
    (initial?.suggestedAmounts ?? DEFAULT_VALUES.suggestedAmounts ?? [])
      .join(", "),
  );

  function setField<K extends keyof FormValues>(k: K, v: FormValues[K]) {
    setValues((prev) => ({ ...prev, [k]: v }));
  }

  function parseSuggested(text: string): number[] {
    return text
      .split(/[,\s]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .slice(0, 8);
  }

  async function handleSave() {
    if (!values.name.trim()) {
      toast.error("Form name is required");
      return;
    }
    if (values.type === "dues" && !values.amount) {
      toast.error("Fixed-amount forms need an amount");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...values,
        suggestedAmounts: parseSuggested(suggestedText),
      };
      const url =
        mode === "create"
          ? "/api/admin/crowded/forms"
          : `/api/admin/crowded/forms/${formId}`;
      const method = mode === "create" ? "POST" : "PATCH";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { message?: string }).message ?? `HTTP ${res.status}`,
        );
      }
      toast.success(
        mode === "create" ? "Form created" : "Saved",
      );
      const newId = (body as { form?: { id?: number } }).form?.id ?? formId;
      if (mode === "create" && newId) {
        router.push(`/admin/crowded/forms/${newId}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  // Preview frame URL — only meaningful in edit mode.
  const previewUrl = useMemo(() => {
    return formId ? `/donate/${formId}?_t=${Date.now()}` : null;
  }, [formId, values]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* LEFT — editor */}
      <div className="space-y-5">
        <Card>
          <CardContent className="space-y-4 px-5 py-5">
            <SectionLabel>Basics</SectionLabel>
            <Field label="Form name" hint="Shown internally + on Crowded.">
              <Input
                value={values.name}
                onChange={(e) => setField("name", e.target.value)}
                maxLength={50}
                placeholder="General Fund 2026"
              />
            </Field>
            <Field label="Type">
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={values.type}
                onChange={(e) =>
                  setField("type", e.target.value as FormValues["type"])
                }
                disabled={mode === "edit"}
              >
                <option value="donation">Donation (open amount)</option>
                <option value="dues">Dues / Fixed amount</option>
              </select>
              {mode === "edit" && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Type can't change after creation — Crowded locks the
                  collection's mode.
                </p>
              )}
            </Field>
            {values.type === "dues" && (
              <Field label="Fixed amount (USD)">
                <Input
                  type="number"
                  min={1}
                  value={values.amount ?? ""}
                  onChange={(e) =>
                    setField(
                      "amount",
                      e.target.value ? parseInt(e.target.value, 10) : null,
                    )
                  }
                  disabled={mode === "edit"}
                />
              </Field>
            )}
            <Field label="Goal (optional, USD)">
              <Input
                type="number"
                min={1}
                value={values.goal ?? ""}
                onChange={(e) =>
                  setField(
                    "goal",
                    e.target.value ? parseInt(e.target.value, 10) : null,
                  )
                }
                disabled={mode === "edit"}
              />
            </Field>
            <Field label="Allow recurring gifts">
              <Toggle
                checked={values.recurringEnabled}
                onChange={(v) => setField("recurringEnabled", v)}
                disabled={mode === "edit"}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-4 px-5 py-5">
            <SectionLabel>Branding</SectionLabel>
            <Field label="Headline">
              <Input
                value={values.headline ?? ""}
                onChange={(e) => setField("headline", e.target.value)}
                maxLength={200}
                placeholder="Help us reach our goal"
              />
            </Field>
            <Field label="Tagline">
              <Textarea
                value={values.tagline ?? ""}
                onChange={(e) => setField("tagline", e.target.value)}
                maxLength={280}
                placeholder="A short sentence that motivates the gift"
                rows={2}
              />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <ColorField
                label="Primary"
                value={values.primaryColor ?? "#00A99D"}
                onChange={(v) => setField("primaryColor", v)}
              />
              <ColorField
                label="Accent"
                value={values.accentColor ?? "#0F2A2E"}
                onChange={(v) => setField("accentColor", v)}
              />
              <ColorField
                label="Background"
                value={values.backgroundColor ?? "#F5F2EC"}
                onChange={(v) => setField("backgroundColor", v)}
              />
            </div>
            <Field label="Logo URL">
              <Input
                value={values.logoUrl ?? ""}
                onChange={(e) => setField("logoUrl", e.target.value || null)}
                placeholder="https://your-site.com/logo.png"
                type="url"
              />
            </Field>
            <Field label="Hero image URL">
              <Input
                value={values.heroImageUrl ?? ""}
                onChange={(e) =>
                  setField("heroImageUrl", e.target.value || null)
                }
                placeholder="https://your-site.com/hero.jpg"
                type="url"
              />
            </Field>
            <Field label="Submit button label">
              <Input
                value={values.submitLabel ?? ""}
                onChange={(e) =>
                  setField("submitLabel", e.target.value || null)
                }
                maxLength={60}
                placeholder="Donate Now"
              />
            </Field>
            <Field
              label="Suggested amounts (comma-separated)"
              hint="Up to 8. e.g. 25, 50, 100, 250, 500, 1000"
            >
              <Input
                value={suggestedText}
                onChange={(e) => setSuggestedText(e.target.value)}
                placeholder="25, 50, 100, 250, 500, 1000"
              />
            </Field>
            <Field label="Success message">
              <Textarea
                value={values.successMessage ?? ""}
                onChange={(e) =>
                  setField("successMessage", e.target.value || null)
                }
                maxLength={500}
                placeholder="Your generosity makes a real difference."
                rows={2}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 px-5 py-5">
            <SectionLabel>Donor fields</SectionLabel>
            <Toggle
              label="Ask for address"
              checked={values.askAddress}
              onChange={(v) => setField("askAddress", v)}
            />
            <Toggle
              label="Ask for phone"
              checked={values.askPhone}
              onChange={(v) => setField("askPhone", v)}
            />
            <Toggle
              label="Allow tribute (in memory / honor of)"
              checked={values.askTribute}
              onChange={(v) => setField("askTribute", v)}
            />
            <Toggle
              label="Show consent checkbox"
              checked={values.requireConsent}
              onChange={(v) => setField("requireConsent", v)}
            />
            <Field label="Default fee model">
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={values.feeCoverDefault}
                onChange={(e) =>
                  setField(
                    "feeCoverDefault",
                    e.target.value as FormValues["feeCoverDefault"],
                  )
                }
              >
                <option value="donor">Donor covers Crowded fees</option>
                <option value="org">Organization absorbs Crowded fees</option>
              </select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Determines how the donor's gift amount is recorded against
                Crowded's net + fee fields.
              </p>
            </Field>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            {mode === "create" ? "Create form" : "Save changes"}
          </Button>
          {formId && (
            <Button variant="outline" asChild>
              <a href={`/donate/${formId}`} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-2 h-4 w-4" />
                Open donor page
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* RIGHT — sticky preview */}
      <div className="lg:sticky lg:top-4 lg:self-start">
        <Card>
          <CardContent className="p-0">
            {previewUrl ? (
              <iframe
                src={previewUrl}
                style={{
                  width: "100%",
                  height: "calc(100vh - 8rem)",
                  border: 0,
                  borderRadius: 12,
                  background: values.backgroundColor || "#F5F2EC",
                }}
                title="Form preview"
              />
            ) : (
              <div
                className="flex items-center justify-center text-sm text-muted-foreground"
                style={{
                  height: "calc(100vh - 8rem)",
                  background: values.backgroundColor || "#F5F2EC",
                }}
              >
                Save the form to see a live preview.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Small helpers ──────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs font-medium">{label}</label>
      <div className="mt-1 flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-9 w-9 cursor-pointer rounded-md border border-input"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="font-mono text-xs"
          maxLength={9}
        />
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  if (label === undefined) {
    return (
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-5 w-5 rounded border-input"
      />
    );
  }
  return (
    <label
      className={`flex items-center justify-between gap-2 ${
        disabled ? "opacity-50" : "cursor-pointer"
      }`}
    >
      <span className="text-sm">{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        className="h-5 w-5 rounded border-input"
      />
    </label>
  );
}
