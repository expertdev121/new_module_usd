"use client";

import React from "react";
import Link from "next/link";
import { Users, DollarSign, Wallet, FileText, type LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface ContactsSummaryCardsProps {
  data?: {
    totalContacts: number;
    totalPledgedAmount: number;
    totalPaidAmount: number;
    contactsWithPledges: number;
    recentContacts: number;
  };
  isLoading?: boolean;
  contactsHref?: string;
  pledgesHref?: string;
  pledgersHref?: string;
  recentHref?: string;
  showViewAll?: boolean;
}

const money = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
const number = (num: number) => new Intl.NumberFormat("en-US").format(num);

interface Metric {
  key: string;
  label: string;
  value: string;
  icon: LucideIcon;
  tintBg: string;
  tintText: string;
  href?: string;
}

export default function ContactsSummaryCards({
  data,
  isLoading,
  contactsHref,
  pledgesHref,
  showViewAll = false,
}: ContactsSummaryCardsProps) {
  // Build only the metrics that are meaningful for THIS tenant, so the row
  // fills cleanly instead of leaving empty columns (donation-only orgs have
  // no pledges, so the pledge card is skipped for them). Grid column count
  // follows the card count so there is never a trailing gap.
  const avgPerContact = data && data.totalContacts > 0 ? data.totalPaidAmount / data.totalContacts : 0;

  const metrics: Metric[] = data
    ? [
        { key: "contacts", label: "Total Contacts", value: number(data.totalContacts), icon: Users, tintBg: "bg-blue-50", tintText: "text-blue-600", href: showViewAll ? contactsHref : undefined },
        { key: "paid", label: "Total Paid", value: money(data.totalPaidAmount), icon: DollarSign, tintBg: "bg-emerald-50", tintText: "text-emerald-600" },
        { key: "avg", label: "Avg per Contact", value: money(avgPerContact), icon: Wallet, tintBg: "bg-violet-50", tintText: "text-violet-600" },
        ...(data.totalPledgedAmount > 0
          ? [{ key: "pledged", label: "Total Pledged", value: money(data.totalPledgedAmount), icon: FileText, tintBg: "bg-amber-50", tintText: "text-amber-600", href: showViewAll ? pledgesHref : undefined } as Metric]
          : []),
      ]
    : [];

  const colClass = metrics.length >= 4 ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3";

  if (isLoading || !data) {
    return (
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index}>
            <CardContent className="flex items-center gap-3 p-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <div className="flex-1">
                <Skeleton className="mb-2 h-3 w-20" />
                <Skeleton className="h-6 w-24" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  /* Clean monochrome cards with a single accent color per metric.
     Typography drives hierarchy: tiny muted label, large tabular-nums value. */
  return (
    <div className={`mb-5 grid grid-cols-1 gap-3 ${colClass}`}>
      {metrics.map((m) => (
        <Card key={m.key}>
          <CardContent className="flex items-center gap-3 p-4">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${m.tintBg} ${m.tintText}`}>
              <m.icon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-muted-foreground">{m.label}</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums">{m.value}</p>
            </div>
            {m.href && (
              <Link href={m.href} className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline">
                View
              </Link>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
