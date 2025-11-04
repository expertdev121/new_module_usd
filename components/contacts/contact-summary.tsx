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
      <div className="space-y-2 mb-6">
        <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Card key={index} className="h-full">
              <CardContent className="flex items-center justify-between p-3">
                <div className="flex-1">
                  <Skeleton className="h-4 w-20 mb-2" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-8 w-8 rounded-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 -mt-10">
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-4">
        <Card className="h-full bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="flex flex-col p-3 h-full">
            <div className="flex items-center justify-between flex-1">
              <div>
                <h3 className="text-sm font-bold text-blue-700">
                  Total Contacts
                </h3>
                <p className="text-lg font-semibold text-blue-800 mt-1">
                  {data ? formatNumber(data.totalContacts) : "0"}
                </p>
              </div>
              <div className="bg-blue-600 text-white p-1.5 rounded-full">
                <Users className="h-3 w-3" />
              </div>
            </div>
            {showViewAll && contactsHref && (
              <Link
                href={contactsHref}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline mt-2 text-right self-end"
              >
                View All
              </Link>
            )}
          </CardContent>
        </Card>

        <Card className="h-full bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="flex flex-col p-3 h-full">
            <div className="flex items-center justify-between flex-1">
              <div>
                <h3 className="text-sm font-bold text-green-700">
                  Pledges
                </h3>
                <p className="text-lg font-semibold text-green-800 mt-1">
                  {data ? formatCurrency(data.totalPledgedAmount) : "$0"}
                </p>
              </div>
              <div className="bg-green-600 text-white p-1.5 rounded-full">
                <DollarSign className="h-3 w-3" />
              </div>
            </div>
            {showViewAll && pledgesHref && (
              <Link
                href={pledgesHref}
                className="text-xs text-green-600 hover:text-green-800 hover:underline mt-2 text-right self-end"
              >
                View All
              </Link>
            )}
          </CardContent>
        </Card>


      </div>
    </div>
  );
}
