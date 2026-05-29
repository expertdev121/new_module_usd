"use client";

/**
 * Tiny visual marker for GHL-sourced manual_donation rows.
 *
 * Renders nothing for hand-entered donations (ghlSource === null) — that
 * keeps the UI clean for accounts that don't use GHL. For GHL-sourced
 * rows, a small coloured pill identifies the source so the admin knows
 * the row was synced (not typed) and where it came from.
 *
 * Used in:
 *   - components/payments/payments-client.tsx  (contact detail → Payments tab)
 *   - Manual donations list views                (admin Financial Module)
 */
import { Receipt, ShoppingBag, Repeat, CreditCard } from "lucide-react";

type GhlSource =
  | "ghl_invoice"
  | "ghl_order"
  | "ghl_subscription"
  | "ghl_transaction"
  | null
  | undefined;

const META: Record<
  Exclude<GhlSource, null | undefined>,
  { label: string; cls: string; Icon: typeof Receipt }
> = {
  ghl_invoice: {
    label: "GHL Invoice",
    cls: "bg-blue-50 text-blue-700",
    Icon: Receipt,
  },
  ghl_order: {
    label: "GHL Order",
    cls: "bg-violet-50 text-violet-700",
    Icon: ShoppingBag,
  },
  ghl_subscription: {
    label: "GHL Subscription",
    cls: "bg-emerald-50 text-emerald-700",
    Icon: Repeat,
  },
  ghl_transaction: {
    label: "GHL Payment",
    cls: "bg-cyan-50 text-cyan-700",
    Icon: CreditCard,
  },
};

export function GhlSourceBadge({ source }: { source: GhlSource }) {
  if (!source) return null;
  const meta = META[source];
  if (!meta) return null;
  const { label, cls, Icon } = meta;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${cls}`}
      title={`Synced from GoHighLevel (${label})`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
