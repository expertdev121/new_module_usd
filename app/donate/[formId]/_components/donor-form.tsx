"use client";

/**
 * Donor-facing form. Designed to convert:
 *
 *   - Big, soft hero with the org's headline + tagline + hero image
 *   - Suggested amount tiles (animated hover, selectable)
 *   - Single-page flow — no multi-step wizard for donations under $1k
 *   - Sticky CTA on mobile
 *   - Live total summary in the button label
 *   - Smooth focus rings (accessible) and reduced-motion friendly
 *   - Plus Jakarta Sans, consistent with the other CMN forms
 *
 * Branding is driven from the form row (primary/accent/background colors,
 * logo, hero image, headline, tagline). Defaults render a polished
 * teal/cream palette that works without any customization.
 */
import { useMemo, useState } from "react";
import type { CrowdedForm } from "@/lib/db/schema-crowded";
import { parseAmount } from "@/lib/money/parse-amount";

interface Props {
  form: CrowdedForm;
}

// ─── Defaults — match DonorHQ admin palette ────────────────────────────────
// Primary green sourced from --primary in app/globals.css (the GiveSuite
// emerald). Background is pure white so the form sits on a clean canvas
// when previewed in the admin shell.
const DEFAULTS = {
  primaryColor: "#16A34A",      // emerald — DonorHQ brand green
  accentColor: "#0A0A0A",       // near-black for headings, like admin foreground
  backgroundColor: "#FFFFFF",   // pure white
  submitLabel: "Donate Now",
  successMessage: "Thank you for your gift!",
  suggestedAmounts: [25, 50, 100, 250, 500, 1000],
};

const FREQUENCY_OPTIONS = [
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "yearly", label: "Yearly" },
] as const;

type Frequency = (typeof FREQUENCY_OPTIONS)[number]["value"];

export function DonorForm({ form }: Props) {
  // ─── Branding ──────────────────────────────────────────────────────────
  const primary = form.primaryColor || DEFAULTS.primaryColor;
  const accent = form.accentColor || DEFAULTS.accentColor;
  const bg = form.backgroundColor || DEFAULTS.backgroundColor;
  const submitLabel = form.submitLabel || DEFAULTS.submitLabel;
  const suggestedAmounts =
    (form.suggestedAmounts && form.suggestedAmounts.length > 0
      ? form.suggestedAmounts
      : DEFAULTS.suggestedAmounts);

  // ─── State ─────────────────────────────────────────────────────────────
  const isFixed = form.type === "dues" && Boolean(form.amountCents);
  const fixedAmount = isFixed ? form.amountCents! / 100 : null;

  const [selectedAmount, setSelectedAmount] = useState<number | null>(
    fixedAmount ?? suggestedAmounts[1] ?? 50,
  );
  const [customAmount, setCustomAmount] = useState<string>("");
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>("monthly");

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [stateField, setStateField] = useState("");
  const [postal, setPostal] = useState("");
  const [country, setCountry] = useState("United States");

  const [tributeOn, setTributeOn] = useState(false);
  const [tributeType, setTributeType] = useState<"memory" | "honor">("honor");
  const [tributeName, setTributeName] = useState("");

  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Derived ───────────────────────────────────────────────────────────
  const effectiveAmount = useMemo(() => {
    if (isFixed) return fixedAmount!;
    // Comma-safe: "1,000" -> 1000 (NOT 1).
    const typed = parseAmount(customAmount);
    if (typed !== null && typed > 0) {
      return Math.round(typed);
    }
    return selectedAmount ?? 0;
  }, [isFixed, fixedAmount, customAmount, selectedAmount]);

  const canSubmit =
    effectiveAmount >= 1 &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    /\S+@\S+\.\S+/.test(email) &&
    (form.requireConsent ? consent : true) &&
    !submitting;

  // ─── Handlers ──────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/public/crowded/forms/${form.id}/intent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: effectiveAmount,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            email: email.trim(),
            mobile: form.askPhone && phone ? phone.trim() : null,
            consent: true,
            recurring: form.recurringEnabled ? recurring : false,
            frequency: recurring ? frequency : undefined,
            tributeName:
              form.askTribute && tributeOn ? tributeName.trim() : null,
            tributeType: form.askTribute && tributeOn ? tributeType : null,
            address: form.askAddress ? address.trim() || null : null,
            city: form.askAddress ? city.trim() || null : null,
            state: form.askAddress ? stateField.trim() || null : null,
            postal: form.askAddress ? postal.trim() || null : null,
            country: form.askAddress ? country.trim() || null : null,
          }),
        },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          (body as { message?: string }).message ??
            "We couldn't start your donation. Please try again.",
        );
      }
      const url = (body as { paymentUrl?: string }).paymentUrl;
      if (!url) throw new Error("Crowded didn't return a checkout URL.");
      // Redirect the donor to Crowded's hosted checkout. They'll come
      // back to /donate/[id]/thank-you (or /failed) after.
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <>
      {/* All styling is scoped via CSS vars on this wrapper, so the form
          re-themes per-row without a stylesheet rewrite. */}
      <div
        className="donor-root"
        style={
          {
            "--primary": primary,
            "--accent": accent,
            "--bg": bg,
          } as React.CSSProperties
        }
      >
        <style jsx>{`
          .donor-root {
            min-height: 100vh;
            background: var(--bg);
            font-family: "Inter", "Plus Jakarta Sans", system-ui,
              -apple-system, "Segoe UI", Roboto, sans-serif;
            color: var(--accent);
            padding: 32px 16px 64px;
            -webkit-font-smoothing: antialiased;
          }
          .shell {
            max-width: 640px;
            margin: 0 auto;
            background: #ffffff;
            border-radius: 16px;
            border: 1px solid rgba(10, 10, 10, 0.08);
            overflow: hidden;
          }
          .hero {
            position: relative;
            padding: 32px 28px 24px;
            background: #ffffff;
            border-bottom: 1px solid rgba(10, 10, 10, 0.08);
          }
          .hero-image {
            width: 100%;
            height: 180px;
            object-fit: cover;
            border-radius: 16px;
            margin-bottom: 20px;
          }
          .logo {
            height: 36px;
            margin-bottom: 16px;
            display: block;
          }
          .headline {
            font-size: 28px;
            font-weight: 700;
            line-height: 1.15;
            color: var(--accent);
            margin: 0;
            letter-spacing: -0.02em;
          }
          .tagline {
            margin-top: 8px;
            font-size: 15px;
            line-height: 1.5;
            color: #525866;
          }
          .body {
            padding: 28px;
          }
          .section-label {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            color: color-mix(in srgb, var(--accent) 60%, white);
            margin-bottom: 10px;
          }
          .amount-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 10px;
            margin-bottom: 12px;
          }
          .amount-tile {
            position: relative;
            border: 1.5px solid rgba(10, 10, 10, 0.10);
            background: #ffffff;
            border-radius: 12px;
            padding: 14px 8px;
            font-size: 18px;
            font-weight: 600;
            color: var(--accent);
            cursor: pointer;
            transition: transform 120ms ease, box-shadow 120ms ease,
              border-color 120ms ease, background 120ms ease;
          }
          .amount-tile:hover {
            transform: translateY(-1px);
            border-color: var(--primary);
            box-shadow: 0 6px 16px rgba(10, 10, 10, 0.06);
          }
          .amount-tile.selected {
            background: var(--primary);
            color: #ffffff;
            border-color: var(--primary);
            box-shadow: 0 8px 20px
              color-mix(in srgb, var(--primary) 30%, transparent);
          }
          .custom-amount-wrap {
            position: relative;
            margin-top: 4px;
          }
          .custom-amount-wrap::before {
            content: "$";
            position: absolute;
            left: 16px;
            top: 50%;
            transform: translateY(-50%);
            color: #4b5560;
            font-weight: 600;
          }
          .input,
          .custom-amount {
            width: 100%;
            border: 1.5px solid rgba(10, 10, 10, 0.10);
            border-radius: 12px;
            padding: 13px 14px;
            font-size: 15px;
            font-family: inherit;
            color: #16181d;
            background: #ffffff;
            transition: border-color 120ms ease, box-shadow 120ms ease;
          }
          .custom-amount {
            padding-left: 30px;
            font-weight: 600;
          }
          .input:focus,
          .custom-amount:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px
              color-mix(in srgb, var(--primary) 18%, transparent);
          }
          .row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
          }
          .field {
            margin-bottom: 14px;
          }
          .checkbox-row {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            font-size: 14px;
            color: #525866;
            margin-top: 4px;
          }
          .checkbox-row input {
            margin-top: 3px;
            accent-color: var(--primary);
            width: 18px;
            height: 18px;
            cursor: pointer;
          }
          .recurring-card {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 14px;
            border: 1.5px solid rgba(10, 10, 10, 0.08);
            border-radius: 12px;
            background: color-mix(in srgb, var(--primary) 4%, white);
            margin: 16px 0;
          }
          .recurring-card.active {
            border-color: var(--primary);
            background: color-mix(in srgb, var(--primary) 8%, white);
          }
          .freq-row {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 8px;
            margin-top: 10px;
          }
          .freq-tile {
            border: 1.5px solid rgba(10, 10, 10, 0.10);
            background: #ffffff;
            border-radius: 10px;
            padding: 10px 6px;
            font-size: 13px;
            font-weight: 600;
            color: var(--accent);
            cursor: pointer;
            text-align: center;
          }
          .freq-tile.selected {
            background: var(--primary);
            color: white;
            border-color: var(--primary);
          }
          .tribute-card {
            padding: 14px;
            border: 1.5px solid rgba(10, 10, 10, 0.08);
            border-radius: 12px;
            margin-bottom: 14px;
          }
          .submit {
            margin-top: 18px;
            width: 100%;
            border: 0;
            border-radius: 14px;
            padding: 17px;
            font-size: 17px;
            font-weight: 700;
            color: white;
            background: var(--primary);
            cursor: pointer;
            transition: transform 80ms ease, box-shadow 120ms ease,
              opacity 120ms ease;
            box-shadow: 0 10px 28px
              color-mix(in srgb, var(--primary) 35%, transparent);
            letter-spacing: 0.01em;
          }
          .submit:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 14px 36px
              color-mix(in srgb, var(--primary) 40%, transparent);
          }
          .submit:disabled {
            opacity: 0.55;
            cursor: not-allowed;
            transform: none;
          }
          .error {
            background: #fff1f1;
            border: 1px solid #f4c4c4;
            color: #9a1f1f;
            padding: 12px 14px;
            border-radius: 10px;
            font-size: 14px;
            margin-top: 14px;
          }
          .legal {
            font-size: 12px;
            color: #6c7280;
            text-align: center;
            margin-top: 16px;
            line-height: 1.5;
          }
          @media (max-width: 480px) {
            .donor-root {
              padding: 0;
            }
            .shell {
              border-radius: 0;
              box-shadow: none;
            }
            .row {
              grid-template-columns: 1fr;
            }
            .amount-grid {
              grid-template-columns: repeat(3, 1fr);
            }
          }
          @media (prefers-reduced-motion: reduce) {
            .amount-tile,
            .submit {
              transition: none;
            }
            .submit:hover:not(:disabled) {
              transform: none;
            }
          }
        `}</style>

        <div className="shell">
          <header className="hero">
            {form.logoUrl && (
              <img className="logo" src={form.logoUrl} alt="" />
            )}
            {form.heroImageUrl && (
              <img className="hero-image" src={form.heroImageUrl} alt="" />
            )}
            <h1 className="headline">
              {form.headline || form.name}
            </h1>
            {form.tagline && <p className="tagline">{form.tagline}</p>}
          </header>

          <form className="body" onSubmit={handleSubmit} noValidate>
            {/* AMOUNT */}
            {!isFixed && (
              <>
                <div className="section-label">Choose an amount</div>
                <div className="amount-grid">
                  {suggestedAmounts.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      className={`amount-tile ${
                        selectedAmount === amt && !customAmount
                          ? "selected"
                          : ""
                      }`}
                      onClick={() => {
                        setSelectedAmount(amt);
                        setCustomAmount("");
                      }}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
                <div className="custom-amount-wrap">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    inputMode="decimal"
                    placeholder="Other amount"
                    className="custom-amount"
                    value={customAmount}
                    onChange={(e) => {
                      setCustomAmount(e.target.value);
                      setSelectedAmount(null);
                    }}
                  />
                </div>
              </>
            )}
            {isFixed && (
              <div
                style={{
                  textAlign: "center",
                  fontSize: 32,
                  fontWeight: 700,
                  color: accent,
                  padding: "12px 0 20px",
                }}
              >
                ${fixedAmount}
              </div>
            )}

            {/* RECURRING */}
            {form.recurringEnabled && (
              <div className={`recurring-card ${recurring ? "active" : ""}`}>
                <input
                  id="recurring"
                  type="checkbox"
                  checked={recurring}
                  onChange={(e) => setRecurring(e.target.checked)}
                  style={{ accentColor: primary, width: 18, height: 18 }}
                />
                <label
                  htmlFor="recurring"
                  style={{ flex: 1, cursor: "pointer", fontSize: 14 }}
                >
                  Make this a recurring gift
                </label>
              </div>
            )}
            {form.recurringEnabled && recurring && (
              <div className="freq-row">
                {FREQUENCY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`freq-tile ${frequency === opt.value ? "selected" : ""}`}
                    onClick={() => setFrequency(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {/* DONOR DETAILS */}
            <div className="section-label" style={{ marginTop: 24 }}>
              Your details
            </div>
            <div className="field row">
              <input
                className="input"
                placeholder="First name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
              />
              <input
                className="input"
                placeholder="Last name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <input
                className="input"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            {form.askPhone && (
              <div className="field">
                <input
                  className="input"
                  type="tel"
                  placeholder="Phone (optional)"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            )}

            {/* ADDRESS */}
            {form.askAddress && (
              <>
                <div className="section-label" style={{ marginTop: 16 }}>
                  Address
                </div>
                <div className="field">
                  <input
                    className="input"
                    placeholder="Street address"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
                <div className="field row">
                  <input
                    className="input"
                    placeholder="City"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="State"
                    value={stateField}
                    onChange={(e) => setStateField(e.target.value)}
                  />
                </div>
                <div className="field row">
                  <input
                    className="input"
                    placeholder="ZIP / Postal"
                    value={postal}
                    onChange={(e) => setPostal(e.target.value)}
                  />
                  <input
                    className="input"
                    placeholder="Country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* TRIBUTE */}
            {form.askTribute && (
              <div className="tribute-card">
                <div className="checkbox-row">
                  <input
                    type="checkbox"
                    id="tribute"
                    checked={tributeOn}
                    onChange={(e) => setTributeOn(e.target.checked)}
                  />
                  <label htmlFor="tribute" style={{ cursor: "pointer" }}>
                    Dedicate this gift in memory or honor of someone
                  </label>
                </div>
                {tributeOn && (
                  <>
                    <div className="freq-row" style={{ marginTop: 12 }}>
                      <button
                        type="button"
                        className={`freq-tile ${tributeType === "honor" ? "selected" : ""}`}
                        onClick={() => setTributeType("honor")}
                      >
                        In honor of
                      </button>
                      <button
                        type="button"
                        className={`freq-tile ${tributeType === "memory" ? "selected" : ""}`}
                        onClick={() => setTributeType("memory")}
                      >
                        In memory of
                      </button>
                      <div />
                    </div>
                    <div className="field" style={{ marginTop: 10 }}>
                      <input
                        className="input"
                        placeholder="Their name"
                        value={tributeName}
                        onChange={(e) => setTributeName(e.target.value)}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* CONSENT */}
            {form.requireConsent && (
              <div className="checkbox-row">
                <input
                  type="checkbox"
                  id="consent"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <label htmlFor="consent" style={{ cursor: "pointer" }}>
                  I agree to be charged ${effectiveAmount}
                  {recurring ? ` ${frequency === "yearly" ? "per year" : frequency === "monthly" ? "per month" : "per quarter"}` : " today"}
                  .
                </label>
              </div>
            )}

            {error && <div className="error">{error}</div>}

            <button type="submit" className="submit" disabled={!canSubmit}>
              {submitting
                ? "Starting checkout…"
                : effectiveAmount > 0
                  ? `${submitLabel} — $${effectiveAmount}${recurring ? `/${frequency === "yearly" ? "yr" : frequency === "monthly" ? "mo" : "qtr"}` : ""}`
                  : submitLabel}
            </button>

            <p className="legal">
              You will be redirected to Crowded to securely complete your
              payment. We never see your card details.
            </p>
          </form>
        </div>
      </div>
    </>
  );
}
