"use client";

import { useMemo, useState } from "react";
import { parseAmount } from "@/lib/money/parse-amount";

const SUGGESTED_AMOUNTS = [25, 50, 100, 250, 500, 1000];

interface Props {
  slug: string;
  title: string;
  coverImageUrl: string | null;
  primaryColor: string;
  backgroundColor: string;
  donorCoversFees: boolean;
}

export function DonateForm({ slug, title, coverImageUrl, primaryColor, backgroundColor, donorCoversFees }: Props) {
  const [selectedAmount, setSelectedAmount] = useState<number | null>(SUGGESTED_AMOUNTS[1]);
  const [customAmount, setCustomAmount] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [coverFees, setCoverFees] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveAmount = useMemo(() => {
    const typed = parseAmount(customAmount);
    if (typed !== null && typed > 0) return Math.round(typed);
    return selectedAmount ?? 0;
  }, [customAmount, selectedAmount]);

  const canSubmit =
    effectiveAmount >= 1 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(email) &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/public/fundraising/${slug}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: effectiveAmount,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          coverFees: donorCoversFees ? coverFees : false,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? "We couldn't start your donation. Please try again.");
      }
      const url = (data as { url?: string }).url;
      if (!url) throw new Error("Stripe didn't return a checkout URL.");
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <div style={{ background: backgroundColor, minHeight: "100vh" }} className="py-8 sm:py-12">
      <main className="mx-auto max-w-lg px-4">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          {coverImageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={coverImageUrl} alt={title} className="h-40 w-full object-cover" />
          ) : (
            <div className="h-16 w-full" style={{ background: `linear-gradient(135deg, ${primaryColor}, ${primaryColor}cc)` }} />
          )}

          <form onSubmit={handleSubmit} className="p-6 sm:p-8" noValidate>
            <h1 className="text-xl font-bold text-gray-900">Donate to {title}</h1>

            <div className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-500">Choose an amount</div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {SUGGESTED_AMOUNTS.map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => {
                    setSelectedAmount(amt);
                    setCustomAmount("");
                  }}
                  className="rounded-lg border px-3 py-3 text-base font-semibold transition-colors"
                  style={
                    selectedAmount === amt && !customAmount
                      ? { background: primaryColor, borderColor: primaryColor, color: "#fff" }
                      : { borderColor: "#e5e7eb", color: "#111827" }
                  }
                >
                  ${amt}
                </button>
              ))}
            </div>
            <div className="relative mt-2">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
              <input
                type="number"
                min={1}
                step={1}
                inputMode="decimal"
                placeholder="Other amount"
                className="w-full rounded-lg border border-gray-200 py-3 pl-7 pr-3 text-base focus:border-gray-400 focus:outline-none"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setSelectedAmount(null);
                }}
              />
            </div>

            <div className="mt-5 text-sm font-semibold uppercase tracking-wide text-gray-500">Your details</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className="rounded-lg border border-gray-200 px-3 py-3 text-base focus:border-gray-400 focus:outline-none"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
              <input
                className="rounded-lg border border-gray-200 px-3 py-3 text-base focus:border-gray-400 focus:outline-none"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
            <input
              type="email"
              className="mt-2 w-full rounded-lg border border-gray-200 px-3 py-3 text-base focus:border-gray-400 focus:outline-none"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

            {donorCoversFees && (
              <label className="mt-4 flex items-start gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={coverFees}
                  onChange={(e) => setCoverFees(e.target.checked)}
                  className="mt-0.5"
                  style={{ accentColor: primaryColor }}
                />
                I&apos;ll cover the processing fees so 100% of my gift goes to the campaign.
              </label>
            )}

            {error && (
              <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="mt-5 w-full rounded-xl px-6 py-3.5 text-base font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
              style={{ background: primaryColor }}
            >
              {submitting ? "Redirecting to Stripe…" : effectiveAmount > 0 ? `Continue — $${effectiveAmount}` : "Continue"}
            </button>
            <p className="mt-3 text-center text-xs text-gray-400">
              You&apos;ll be redirected to Stripe to securely complete your payment. We never see your card details.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
