"use client";

import TabLink from "@/components/next-link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, ArrowLeft, RefreshCw, Plus, Receipt } from "lucide-react";
import { useContactQuery } from "@/lib/query/useContactDetails";
import { useParams } from "next/navigation";
import { useSession } from "next-auth/react";
import type React from "react";
import Link from "next/link";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0);

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { contactId } = useParams<{ contactId: string }>();
  const contactIdNum = parseInt(contactId, 10);
  const isValidId = !isNaN(contactIdNum);
  const { data: session } = useSession();
  const userRole = session?.user?.role;
  const isAdmin = userRole === "admin" || userRole === "super_admin";

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {!isValidId ? (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Invalid contact ID provided. Please check the URL and try again.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <ContactHeader contactId={contactIdNum} />
          <div className="border-b">
            <nav className="-mb-px flex gap-6 overflow-x-auto">
              <TabLink href={`/contacts/${contactId}`} exact>
                Overview
              </TabLink>
              {/* Payments sits right after Overview — it's the most-used tab;
                  Pledges / Payment Plans are used by almost no tenants. */}
              <TabLink href={`/contacts/${contactId}/payments`}>Payments</TabLink>
              <TabLink href={`/contacts/${contactId}/pledges`}>Pledges</TabLink>
              <TabLink href={`/contacts/${contactId}/payment-plans`}>
                Payment Plans
              </TabLink>
              {isAdmin && (
                <TabLink href={`/contacts/${contactId}/solicitor`}>
                  Solicitor
                </TabLink>
              )}
            </nav>
          </div>
          <div className="pt-2">{children}</div>
        </>
      )}
    </div>
  );
}

function ContactHeader({ contactId }: { contactId: number }) {
  const { data, isLoading, isError, error, refetch } = useContactQuery({
    contactId,
    page: 1,
    limit: 10,
  });

  if (isLoading) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <Skeleton className="h-14 w-14 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-56" />
            <Skeleton className="h-4 w-80" />
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  if (isError || !data?.contact) {
    return (
      <Alert variant={isError ? "destructive" : "default"}>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="flex items-center justify-between">
          <span>{isError ? `Error loading contact: ${error?.message ?? "unknown"}` : "No contact data available"}</span>
          <button onClick={() => refetch?.()} className="ml-2 rounded-sm p-1 transition-colors hover:bg-black/5" aria-label="Retry">
            <RefreshCw className="h-4 w-4" />
          </button>
        </AlertDescription>
      </Alert>
    );
  }

  const contact = data.contact;
  const fin = (data.financialSummary ?? []).reduce(
    (acc, curr) => ({
      totalPledgedUsd: acc.totalPledgedUsd + (Number(curr.totalPledgedUsd) || 0),
      totalPaidUsd: acc.totalPaidUsd + (Number(curr.totalPaidUsd) || 0),
      totalManualDonationsUsd: acc.totalManualDonationsUsd + (Number(curr.totalManualDonationsUsd) || 0),
      currentBalanceUsd: acc.currentBalanceUsd + (Number(curr.currentBalanceUsd) || 0),
    }),
    { totalPledgedUsd: 0, totalPaidUsd: 0, totalManualDonationsUsd: 0, currentBalanceUsd: 0 },
  );

  const lifetime = fin.totalPaidUsd + fin.totalManualDonationsUsd;
  const pledged = fin.totalPledgedUsd;
  const paidToPledges = fin.totalPaidUsd;
  const balance = fin.currentBalanceUsd;
  const pct = pledged > 0 ? Math.min(100, Math.round((paidToPledges / pledged) * 100)) : 0;

  const name = contact.displayName?.trim() || `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown Contact";
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  const sinceYear = contact.createdAt ? new Date(contact.createdAt).getFullYear() : null;
  const isMajor = lifetime >= 10000;
  const isHousehold = Boolean(contact.householdId);

  const meta: React.ReactNode[] = [];
  if (contact.email) meta.push(contact.email);
  if (contact.phone) meta.push(contact.phone);
  if (sinceYear) meta.push(`Donor since ${sinceYear}`);

  return (
    <Card className="overflow-hidden">
      {/* Identity + primary actions */}
      <div className="flex flex-wrap items-start justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-4">
          <Link
            href="/contacts"
            aria-label="Back to donors"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-green-500 to-green-700 text-lg font-bold text-white">
            {initials}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-2xl font-bold tracking-tight">{name}</h1>
              {isMajor && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-green-700 dark:bg-green-950/50 dark:text-green-400">
                  Major donor
                </span>
              )}
              {isHousehold && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Household
                </span>
              )}
            </div>
            {meta.length > 0 && (
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                {meta.map((m, i) => (
                  <span key={i} className="tabular-nums">{m}</span>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" className="gap-2">
            <Link href={`/contacts/${contactId}/pledges?new=1`}>
              <Plus className="h-4 w-4" /> Add pledge
            </Link>
          </Button>
          <Button asChild className="gap-2">
            <Link href={`/contacts/${contactId}/payments?new=1`}>
              <Receipt className="h-4 w-4" /> Record payment
            </Link>
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 border-t lg:grid-cols-4">
        <Stat label="Lifetime giving" value={money(lifetime)} />
        <Stat label="Pledged" value={money(pledged)} className="border-l" />
        <Stat label="Paid" value={money(paidToPledges)} valueClass="text-green-600 dark:text-green-500" className="border-l" />
        <Stat
          label="Balance"
          value={money(balance)}
          valueClass={balance > 0 ? "text-amber-600 dark:text-amber-500" : undefined}
          className="border-l"
        />
      </div>

      {/* Pledge fulfilment — only when there is a pledge to fulfil */}
      {pledged > 0 && (
        <div className="border-t px-5 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Pledge fulfilment</span>
            <span className="text-muted-foreground">
              <span className="font-semibold text-green-600 dark:text-green-500">{pct}% complete</span>
              {" · "}
              <span className="tabular-nums">{money(paidToPledges)} of {money(pledged)}</span>
            </span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-green-500 transition-[width]" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
    </Card>
  );
}

function Stat({
  label,
  value,
  valueClass,
  className,
}: {
  label: string;
  value: string;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={`px-5 py-4 ${className ?? ""}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${valueClass ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}
