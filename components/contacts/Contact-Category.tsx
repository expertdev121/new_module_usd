"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Category, useContactCategories } from "@/lib/query/useContactCategories";
import { DollarSign } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";

// Extended interface for categories that includes scheduledUsd from the backend
interface ExtendedCategory extends Category {
  scheduledUsd?: number | string; // Allow both number and string from backend
}

export default function ContactCategoriesCard() {
  const { contactId } = useParams<{ contactId: string }>();
  const [page, setPage] = useState(1);
  const limit = 10;

  const { data: categoriesData, isLoading, isError } = useContactCategories(
    parseInt(contactId || "0"),
    page,
    limit
  );

  const categories = categoriesData?.categories || [];
  const pagination = categoriesData?.pagination;

  const getScheduledAmount = (category: ExtendedCategory) => {
    let scheduled = category.scheduledUsd;

    if (typeof scheduled === "string") {
      scheduled = parseFloat(scheduled);
    } else if (scheduled === null || scheduled === undefined) {
      scheduled = 0;
    }

    const validScheduled =
      typeof scheduled === "number" && !isNaN(scheduled) ? scheduled : 0;

    console.log(
      `💰 Scheduled amount for ${category.categoryName}: $${validScheduled} (from backend)`
    );
    return validScheduled.toLocaleString("en-US");
  };

  const calculateUnscheduled = (
    balance: string | number,
    scheduled: string | number
  ) => {
    let balanceNum = balance;
    if (typeof balanceNum === "string") {
      balanceNum = parseFloat(balanceNum);
    }
    const validBalance =
      typeof balanceNum === "number" && !isNaN(balanceNum) ? balanceNum : 0;

    let scheduledNum = scheduled;
    if (typeof scheduledNum === "string") {
      scheduledNum = parseFloat(scheduledNum);
    }
    const validScheduled =
      typeof scheduledNum === "number" && !isNaN(scheduledNum)
        ? scheduledNum
        : 0;

    const unscheduled = Math.max(0, validBalance - validScheduled);

    console.log(
      `📊 Unscheduled calculation: Balance($${validBalance}) - Scheduled($${validScheduled}) = $${unscheduled}`
    );
    return unscheduled.toLocaleString("en-US");
  };

  const sortedCategories = [...categories].sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName)
  );

  console.log(
    "\n🔍 Categories with scheduled amounts from backend:",
    sortedCategories
  );

  return (
    <Card className="w-full lg:col-span-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DollarSign className="h-5 w-5" />
          Financial Summary
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="font-bold">Category</TableHead>
              <TableHead className="font-bold text-right">Pledges</TableHead>
              <TableHead className="font-bold text-right">Paid</TableHead>
              <TableHead className="font-bold text-right">Balance</TableHead>
              <TableHead className="font-bold text-right">Pledges</TableHead>
              <TableHead className="font-bold text-right italic">
                Scheduled
              </TableHead>
              <TableHead className="font-bold text-right italic">
                Unscheduled
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedCategories.map((category) => {
              const scheduledAmount = getScheduledAmount(category);
              const unscheduledAmount = calculateUnscheduled(
                category.currentBalanceUsd,
                category.scheduledUsd || 0
              );

              return (
                <TableRow key={category.categoryId}>
                  <TableCell className="font-bold">
                    <Link
                      href={`/contacts/${contactId}/pledges?categoryId=${category?.categoryId}`}
                      className="font-bold text-primary hover:underline hover:text-primary-dark transition-colors duration-200"
                    >
                      {category.categoryName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    ${(
                      typeof category.totalPledgedUsd === "number"
                        ? category.totalPledgedUsd
                        : parseFloat(category.totalPledgedUsd) || 0
                    ).toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-right">
                    ${(
                      typeof category.totalPaidUsd === "number"
                        ? category.totalPaidUsd
                        : parseFloat(category.totalPaidUsd) || 0
                    ).toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-right">
                    ${(
                      typeof category.currentBalanceUsd === "number"
                        ? category.currentBalanceUsd
                        : parseFloat(category.currentBalanceUsd) || 0
                    ).toLocaleString("en-US")}
                  </TableCell>
                  <TableCell className="text-right">
                    {category.pledgeCount}
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-evenly italic text-blue-600">
                      ${scheduledAmount}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="flex justify-evenly italic text-red-600">
                      ${unscheduledAmount}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {pagination && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Page {page} of {pagination.totalPages} ({pagination.total} total categories)
            </div>
            <div className="flex items-center space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(page + 1)}
                disabled={page >= pagination.totalPages}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
