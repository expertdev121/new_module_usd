/**
 * Public page opened from the "Confirm you received this email" link in the DonorHQ alert test email.
 * Opening it changes nothing: the address is only confirmed when the button is pressed.
 */
import type { Metadata } from "next";
import { inspectConfirmLink } from "@/lib/accounting/alerts";
import { maskEmail } from "@/lib/accounting/alert-confirm";
import { ConfirmButton } from "./confirm-button";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Confirm your email | DonorHQ", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function ConfirmAlertEmailPage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const raw = (await searchParams).t;
  const token = Array.isArray(raw) ? raw[0] : raw;
  const info = token ? inspectConfirmLink(token) : { valid: false, email: null };

  return (
    <div style={{ minHeight: "100vh", background: "#F8FAFC", padding: "60px 16px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", background: "#fff", borderRadius: 12, padding: 32, boxShadow: "0 1px 4px rgba(0,0,0,.08)", fontFamily: "system-ui, sans-serif" }}>
        <h1 style={{ fontSize: 22, margin: "0 0 12px" }}>DonorHQ Accounting alerts</h1>
        {info.valid && token ? (
          <>
            <p style={{ color: "#334155", lineHeight: 1.5 }}>
              Confirm that <strong>{maskEmail(info.email ?? "")}</strong> should receive an email if a nightly QuickBooks sync fails. You will only get one email at most every 20 hours.
            </p>
            <ConfirmButton token={token} />
          </>
        ) : (
          <p style={{ color: "#b91c1c", lineHeight: 1.5 }}>This confirm link is invalid or has expired. In DonorHQ, open Settings &gt; Accounting &gt; General and press Send test email to get a new one.</p>
        )}
      </div>
    </div>
  );
}
