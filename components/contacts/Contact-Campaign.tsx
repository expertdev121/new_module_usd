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
import { DollarSign, Download } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

interface FinancialRecord {
  id: number;
  type: "pledge" | "payment" | "donation";
  date: string;
  campaign: string;
  category?: string;
  relationship?: string;
  description?: string;
  pledgeAmount?: number;
  paymentAmount?: number;
  balance?: number;
  paymentMethod?: string;
  referenceNumber?: string;
  solicitor?: string;
  currency: string;
  notes?: string;
}

interface FinancialHistoryData {
  records: FinancialRecord[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    totalPledged: number;
    totalPaid: number;
    totalBalance: number;
    totalDonations: number;
  };
}

export default function FinancialHistoryGrid() {
  const { contactId } = useParams<{ contactId: string }>();
  const [page, setPage] = useState(1);
  const limit = 10; // Show 10 records per page

  const { data, isLoading, isError } = useQuery<FinancialHistoryData>({
    queryKey: ["financial-history", contactId, page, limit],
    queryFn: async () => {
      const response = await fetch(
        `/api/contacts/${contactId}/financial-history?page=${page}&limit=${limit}`
      );
      if (!response.ok) throw new Error("Failed to fetch financial history");
      return response.json();
    },
  });

  const handleExport = () => {
    // Export to CSV functionality
    if (!data?.records) return;

    const headers = [
      "Date",
      "Type",
      "Campaign",
      "Category",
      "Description",
      "Pledge Amount",
      "Payment Amount",
      "Balance",
      "Payment Method",
      "Solicitor",
      "Currency",
      "Notes",
    ];

    const rows = data.records.map((record) => [
      record.date,
      record.type.toUpperCase(),
      record.campaign || "",
      record.category || "",
      record.description || "",
      record.pledgeAmount?.toFixed(2) || "",
      record.paymentAmount?.toFixed(2) || "",
      record.balance?.toFixed(2) || "",
      record.paymentMethod || "",
      record.solicitor || "",
      record.currency,
      record.notes || "",
    ]);

    const csv = [headers, ...rows].map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `financial-history-${contactId}-${new Date().toISOString()}.csv`;
    a.click();
  };

  if (isLoading) {
    return (
      <Card className="w-full lg:col-span-2">
        <CardHeader>
          <CardTitle>Loading financial history...</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card className="w-full lg:col-span-2">
        <CardHeader>
          <CardTitle>Error loading financial history</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="w-full lg:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Complete Financial History
          </CardTitle>
          <Button onClick={handleExport} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export to CSV
          </Button>
        </div>
        {data.summary && (
          <div className="grid grid-cols-4 gap-4 mt-4 text-sm">
            <div className="bg-blue-50 p-3 rounded">
              <div className="text-muted-foreground">Total Pledged</div>
              <div className="text-lg font-bold text-blue-600">
                ${data.summary.totalPledged.toLocaleString("en-US")}
              </div>
            </div>
            <div className="bg-green-50 p-3 rounded">
              <div className="text-muted-foreground">Total Paid</div>
              <div className="text-lg font-bold text-green-600">
                ${data.summary.totalPaid.toLocaleString("en-US")}
              </div>
            </div>
            <div className="bg-orange-50 p-3 rounded">
              <div className="text-muted-foreground">Balance</div>
              <div className="text-lg font-bold text-orange-600">
                ${data.summary.totalBalance.toLocaleString("en-US")}
              </div>
            </div>
            <div className="bg-purple-50 p-3 rounded">
              <div className="text-muted-foreground">Direct Donations</div>
              <div className="text-lg font-bold text-purple-600">
                ${data.summary.totalDonations.toLocaleString("en-US")}
              </div>
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-bold w-[100px]">Date</TableHead>
                <TableHead className="font-bold w-[80px]">Type</TableHead>
                <TableHead className="font-bold">Campaign</TableHead>
                <TableHead className="font-bold">Category</TableHead>
                <TableHead className="font-bold">Description</TableHead>
                <TableHead className="font-bold text-right">Pledge</TableHead>
                <TableHead className="font-bold text-right">Payment</TableHead>
                <TableHead className="font-bold text-right">Balance</TableHead>
                <TableHead className="font-bold">Method</TableHead>
                <TableHead className="font-bold">Solicitor</TableHead>
                <TableHead className="font-bold">Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.records.map((record) => (
                <TableRow key={`${record.type}-${record.id}`}>
                  <TableCell className="text-sm">
                    {new Date(record.date).toLocaleDateString("en-US")}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`px-2 py-1 rounded text-xs font-semibold ${
                        record.type === "pledge"
                          ? "bg-blue-100 text-blue-700"
                          : record.type === "payment"
                          ? "bg-green-100 text-green-700"
                          : "bg-purple-100 text-purple-700"
                      }`}
                    >
                      {record.type.toUpperCase()}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm">
                    {record.campaign || "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {record.category || "-"}
                  </TableCell>
                  <TableCell className="text-sm max-w-[200px] truncate">
                    {record.description || "-"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium">
                    {record.pledgeAmount
                      ? `${record.pledgeAmount.toLocaleString("en-US")}`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium text-green-600">
                    {record.paymentAmount
                      ? `${record.paymentAmount.toLocaleString("en-US")}`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-right text-sm font-medium text-orange-600">
                    {record.balance !== undefined
                      ? `${record.balance.toLocaleString("en-US")}`
                      : "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {record.paymentMethod || "-"}
                  </TableCell>
                  <TableCell className="text-sm">
                    {record.solicitor || "-"}
                  </TableCell>
                  <TableCell className="text-sm max-w-[150px] truncate">
                    {record.notes || "-"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {data.pagination && (
          <div className="flex items-center justify-between mt-4">
            <div className="text-sm text-muted-foreground">
              Page {page} of {data.pagination.totalPages} (
              {data.pagination.total} total records)
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
                disabled={page >= data.pagination.totalPages}
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