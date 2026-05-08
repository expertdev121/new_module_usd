"use client";

import React from "react";
import Link from "next/link";
import { Users, DollarSign, UserCheck, Clock } from "lucide-react";
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

export default function ContactsSummaryCards({
  data,
  isLoading,
  contactsHref,
  pledgesHref,
  pledgersHref,
  recentHref,
  showViewAll = false,
}: ContactsSummaryCardsProps) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-US").format(num);
  };

  if (isLoading) {
    return (
      <div className="mb-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 2 }).map((_, index) => (
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
     Typography drives hierarchy: tiny muted label, large tabular-nums value.
     No gradients, no borders fighting the page — the white card on the
     gray page already provides separation. */
  return (
    <div className="mb-5 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
            <Users className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              Total Contacts
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums">
              {data ? formatNumber(data.totalContacts) : "0"}
            </p>
          </div>
          {showViewAll && contactsHref && (
            <Link
              href={contactsHref}
              className="shrink-0 text-xs text-muted-foreground transition-colors hover:text-foreground hover:underline"
            >
              View
            </Link>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <DollarSign className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-muted-foreground">
              Total Paid
            </p>
            <p className="mt-0.5 text-2xl font-semibold tabular-nums">
              {data ? formatCurrency(data.totalPaidAmount) : "$0"}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
