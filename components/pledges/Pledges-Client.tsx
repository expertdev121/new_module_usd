"use client";

import React, { useState, useEffect } from "react";
import { useQueryState } from "nuqs";
import { z } from "zod";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BadgeDollarSign,
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Search,
  Edit,
} from "lucide-react";
import { usePledgesQuery } from "@/lib/query/usePledgeData";
import { LinkButton } from "../ui/next-link";
import PledgeDialog from "../forms/pledge-form";
import { useCategories } from "@/lib/query/useCategories";
import PaymentDialogClient from "../forms/payment-dialog";
import PaymentPlanDialog from "../forms/payment-plan-dialog";
import Link from "next/link";
import useContactId from "@/hooks/use-contact-id";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDeletePledge, PledgeQueryParams } from "@/lib/query/pledge/usePledgeQuery";
import { formatDate } from "@/lib/utils";
import { useSession } from "next-auth/react";

const QueryParamsSchema = z.object({
  contactId: z.number().positive(),
  categoryId: z.number().positive().nullable().optional(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  status: z.enum(["fullyPaid", "partiallyPaid", "unpaid"]).optional(),
  search: z.string().optional(),
});

type StatusType = "fullyPaid" | "partiallyPaid" | "unpaid";

// Define the form data shape for USD-only pledges
interface PledgeFormData {
  id?: number;
  contactId: number;
  categoryId?: number;
  description: string;
  pledgeDate: string;
  originalAmount: number; // USD amount
  campaignCode?: string;
  notes?: string;
}

// Updated interface without relationship data
interface PledgeApiResponse {
  id: number;
  categoryId?: number;
  description?: string | null;
  pledgeDate: string;
  currency: string;
  originalAmount: string;
  originalAmountUsd?: string | null;
  campaignCode?: string | null;
  notes?: string | null;
  categoryName?: string | null;
  categoryDescription?: string | null;
  totalPaidUsd?: string | null;
  totalPaid: string;
  balanceUsd?: string | null;
  balance: string;
  scheduledAmount?: string | null;
  unscheduledAmount?: string | null;
  paymentPlan?: {
    planName?: string | null;
    frequency?: string;
    distributionType?: string;
    totalPlannedAmount?: string;
    installmentAmount?: string;
    numberOfInstallments?: number;
    installmentsPaid?: number;
    nextPaymentDate?: string | null;
    planStatus?: string;
    autoRenew?: boolean;
    notes?: string | null;
    startDate?: string;
    endDate?: string | null;
    installmentSchedule?: {
      id: number;
      installmentDate: string;
      installmentAmount: string;
      currency: string;
      status: string;
      paidDate?: string | null;
      notes?: string | null;
    }[];
  } | null;
}

export default function PledgesTable() {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [pledgeToDelete, setPledgeToDelete] = useState<{
    id: number;
    description: string;
  } | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingPledge, setEditingPledge] = useState<PledgeFormData | null>(null);

  const { data: session } = useSession();
  const { mutate: deletePledge, isPending: isDeleting } = useDeletePledge();

  const [categoryId] = useQueryState("categoryId", {
    parse: (value) => {
      if (!value) return null;
      const parsed = Number.parseInt(value);
      return isNaN(parsed) ? null : parsed;
    },
    serialize: (value) =>
      value !== null && value !== undefined ? value.toString() : "",
  });
  const [page, setPage] = useQueryState("page", {
    parse: (value) => Number.parseInt(value) || 1,
    serialize: (value) => value.toString(),
  });
  const [limit] = useQueryState("limit", {
    parse: (value) => Number.parseInt(value) || 10,
    serialize: (value) => value.toString(),
  });
  const [search, setSearch] = useQueryState("search");
  const [status, setStatus] = useQueryState<StatusType | null>("status", {
    parse: (value) => {
      if (
        value === "fullyPaid" ||
        value === "partiallyPaid" ||
        value === "unpaid"
      ) {
        return value as StatusType;
      }
      return null;
    },
    serialize: (value) => value ?? "",
  });
  const [startDate] = useQueryState("startDate");
  const [endDate] = useQueryState("endDate");

  const currentPage = page ?? 1;
  const currentLimit = limit ?? 10;

  const contactId = useContactId();

  const queryParams = QueryParamsSchema.parse({
    contactId,
    categoryId: categoryId ?? undefined,
    page: currentPage,
    limit: currentLimit,
    search: search ?? undefined,
    status: status ?? undefined,
    startDate: startDate ?? undefined,
    endDate: endDate ?? undefined,
  });

  const pledgeQueryParams: PledgeQueryParams = {
    contactId: queryParams.contactId,
    categoryId: queryParams.categoryId ?? undefined,
    page: queryParams.page,
    limit: queryParams.limit,
    search: queryParams.search,
    status: queryParams.status,
    startDate: queryParams.startDate,
    endDate: queryParams.endDate,
  };

  const { data, isLoading, error, refetch } = usePledgesQuery(pledgeQueryParams);

  // Fetch categories for the pledge form
  const { data: categories } = useCategories();

  useEffect(() => {
    if (data?.pledges) {
      console.log("=== PLEDGES TABLE DEBUG ===");
      console.log("Total pledges received:", data.pledges.length);
    }
  }, [data]);

  const toggleRowExpansion = (pledgeId: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(pledgeId)) {
      newExpanded.delete(pledgeId);
    } else {
      newExpanded.add(pledgeId);
    }
    setExpandedRows(newExpanded);
  };

  const formatCurrency = (amount: string, currency: string) => {
    const value = Number.parseFloat(amount) || 0;
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);

    const currencySymbol = formatted.replace(/[\d,.\s]/g, "");
    const numericAmount = formatted.replace(/[^\d,.\s]/g, "").trim();

    return { symbol: currencySymbol, amount: numericAmount };
  };

  const formatUSDAmount = (amount: string | null | undefined) => {
    if (!amount) return "N/A";
    const value = Number.parseFloat(amount) || 0;
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const handleDeletePledge = (pledgeId: number, pledgeDescription: string) => {
    setPledgeToDelete({ id: pledgeId, description: pledgeDescription });
    setDeleteDialogOpen(true);
  };

  const confirmDeletePledge = () => {
    if (!pledgeToDelete) return;

    deletePledge(pledgeToDelete.id, {
      onSuccess: () => {
        const newExpanded = new Set(expandedRows);
        newExpanded.delete(pledgeToDelete.id);
        setExpandedRows(newExpanded);
        setDeleteDialogOpen(false);
        setPledgeToDelete(null);
      },
      onError: (error) => {
        console.error("Failed to delete pledge:", error);
        alert("Failed to delete pledge. Please try again.");
      },
    });
  };

  const cancelDeletePledge = () => {
    setDeleteDialogOpen(false);
    setPledgeToDelete(null);
  };

  // FIXED: Fetch full pledge data from API instead of using table data
  const handleEditClick = async (pledgeId: number) => {
    try {
      // Fetch full pledge details from API to get all data including campaignCode
      const response = await fetch(`/api/pledges/${pledgeId}`);
      if (!response.ok) {
        throw new Error('Failed to fetch pledge details');
      }
      
      const fullPledgeData = await response.json();
      
      // Map the full API response to form data structure (USD-only)
      const formData: PledgeFormData = {
        id: fullPledgeData.pledge.id,
        contactId: fullPledgeData.contact?.id || (contactId as number),
        categoryId: fullPledgeData.category?.id,
        description: fullPledgeData.pledge.description || "",
        pledgeDate: fullPledgeData.pledge.pledgeDate,
        originalAmount: fullPledgeData.pledge.originalAmountUsd,
        campaignCode: fullPledgeData.pledge.campaignCode || undefined,
        notes: fullPledgeData.pledge.notes || undefined,
      };
      
      console.log('Full pledge data for edit:', formData);
      
      setEditingPledge(formData);
      setEditDialogOpen(true);
    } catch (error) {
      console.error('Error fetching pledge details:', error);
      alert('Failed to load pledge details. Please try again.');
    }
  };

  const handleEditDialogChange = (open: boolean) => {
    setEditDialogOpen(open);
    if (!open) {
      setEditingPledge(null);
    }
  };

  const handlePledgeUpdated = (pledgeId: number) => {
    console.log("Pledge updated:", pledgeId);
    refetch();
    setEditDialogOpen(false);
    setEditingPledge(null);
  };

  const handlePledgeCreated = (pledgeId: number) => {
    console.log("Pledge created:", pledgeId);
    refetch();
  };

  const calculateExchangeRate = (originalAmount: string, originalAmountUsd: string | null | undefined): number => {
    const amount = Number.parseFloat(originalAmount);
    const amountUsd = Number.parseFloat(originalAmountUsd || "0");

    if (amount === 0 || !amountUsd) return 1;

    return amountUsd / amount;
  };

  const getPaymentPlanStatus = (scheduledAmount: string | null | undefined) => {
    const scheduled = Number.parseFloat(scheduledAmount || "0");
    return scheduled > 0 ? "Yes" : "No";
  };

  const getInstallmentInfo = (pledge: PledgeApiResponse) => {
    const hasScheduled = Number.parseFloat(pledge.scheduledAmount || "0") > 0;

    if (!hasScheduled) {
      return { first: "No Plan", last: "No Plan" };
    }

    if (pledge.paymentPlan) {
      const firstDate = pledge.paymentPlan.installmentSchedule?.[0]?.installmentDate ||
        pledge.paymentPlan.startDate;
      const lastDate = pledge.paymentPlan.installmentSchedule?.slice(-1)[0]?.installmentDate ||
        pledge.paymentPlan.endDate;

      return {
        first: firstDate ? formatDate(firstDate) : "TBD",
        last: lastDate ? formatDate(lastDate) : "TBD"
      };
    }

    return { first: "TBD", last: "TBD" };
  };

  const mapPledgeToFormData = (pledge: PledgeApiResponse, contactId: number): PledgeFormData => {
    return {
      id: pledge.id,
      contactId: contactId,
      categoryId: pledge.categoryId,
      description: pledge.description || "",
      pledgeDate: pledge.pledgeDate,
      originalAmount: Number.parseFloat(pledge.originalAmountUsd || "0"),
      campaignCode: pledge.campaignCode || undefined,
      notes: pledge.notes || undefined,
    };
  };

  // NEW: Compute balance (overpayment shows as negative)
  const calculateBalance = (pledge: PledgeApiResponse) => {
    const pledged = Number.parseFloat(pledge.originalAmount) || 0;
    const paid = Number.parseFloat(pledge.totalPaid) || 0;
    return pledged - paid;
  };

  const calculateBalanceUsd = (pledge: PledgeApiResponse) => {
    const pledgedUsd = Number.parseFloat(pledge.originalAmountUsd || "0") || 0;
    const paidUsd = Number.parseFloat(pledge.totalPaidUsd || "0") || 0;
    return pledgedUsd - paidUsd;
  };

  if (error) {
    return (
      <Alert className="mx-4 my-6">
        <AlertDescription>
          Failed to load pledges data. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6 py-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Pledges and Donations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search..."
                value={search || ""}
                onChange={(e) => setSearch(e.target.value || null)}
                className="pl-10"
              />
            </div>
            <Select
              value={status as string}
              onValueChange={(value) => {
                if (
                  value === "fullyPaid" ||
                  value === "partiallyPaid" ||
                  value === "unpaid"
                ) {
                  setStatus(value as StatusType);
                } else {
                  setStatus(null);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fullyPaid">$ Fully Paid</SelectItem>
                <SelectItem value="partiallyPaid">$ Partially Paid</SelectItem>
                <SelectItem value="unpaid">$ Unpaid</SelectItem>
              </SelectContent>
            </Select>
            {session?.user?.role !== "user" && (
              <PledgeDialog
                contactId={contactId as number}
                onPledgeCreated={handlePledgeCreated}
                categories={categories}
              />
            )}
          </div>

          {/* Table */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Pledges Date
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Pledges Detail
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 text-center">
                    Pledges Amount
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 text-center">
                    Paid
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 text-center">
                    Balance
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 text-center">
                    Scheduled
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900 text-center">
                    Unscheduled
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Notes
                  </TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: currentLimit }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell className="text-center"><Skeleton className="h-4 w-20 ml-auto" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-4" /></TableCell>
                    </TableRow>
                  ))
                ) : data?.pledges.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-gray-500">
                      No Pledges found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.pledges.map((pledge: PledgeApiResponse) => {
                    const pledgeData = mapPledgeToFormData(pledge, contactId as number);
                    const installmentInfo = getInstallmentInfo(pledge);

                    return (
                      <React.Fragment key={pledge.id}>
                        <TableRow className="hover:bg-gray-50">
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleRowExpansion(pledge.id)}
                              className="p-1"
                            >
                              {expandedRows.has(pledge.id) ? (
                                <ChevronDown className="h-4 w-4" />
                              ) : (
                                <ChevronRight className="h-4 w-4" />
                              )}
                            </Button>
                          </TableCell>
                          <TableCell className="font-medium">
                            {formatDate(pledge.pledgeDate)}
                          </TableCell>
                          <TableCell>
                            {typeof pledge.categoryName === 'string' ? pledge.categoryName.split(" ")[0] : 'Unknown'} {">"}{" "}
                            {pledge.description || "-"}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex justify-end items-center gap-1">
                              <span>
                                {formatCurrency(pledge.originalAmount, pledge.currency).symbol}
                              </span>
                              <span>
                                {formatCurrency(pledge.originalAmount, pledge.currency).amount}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex justify-end items-center gap-1">
                              <span>
                                {formatCurrency(pledge.totalPaid, pledge.currency).symbol}
                              </span>
                              <span>
                                {formatCurrency(pledge.totalPaid, pledge.currency).amount}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex justify-end items-center gap-1">
                              <span>
                                {formatCurrency(calculateBalance(pledge).toString(), pledge.currency).symbol}
                              </span>
                              <span>
                                {formatCurrency(calculateBalance(pledge).toString(), pledge.currency).amount}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex justify-end items-center gap-1">
                              <span>
                                {formatCurrency(pledge.scheduledAmount || "0", pledge.currency).symbol}
                              </span>
                              <span className="font-medium">
                                {formatCurrency(pledge.scheduledAmount || "0", pledge.currency).amount}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex justify-end items-center gap-1">
                              <span>
                                {formatCurrency(pledge.unscheduledAmount || "0", pledge.currency).symbol}
                              </span>
                              <span className=" font-medium">
                                {formatCurrency(pledge.unscheduledAmount || "0", pledge.currency).amount}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">
                            {pledge.notes || "-"}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="p-1">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem asChild>
                                  <Link
                                    href={`/contacts/${contactId}/payments?pledgeId=${pledge.id}`}
                                    className="flex items-center"
                                  >
                                    <BadgeDollarSign className="mr-2 h-4 w-4" />
                                    View Payments
                                  </Link>
                                </DropdownMenuItem>
                                {session?.user?.role !== "user" && (
                                  <DropdownMenuItem
                                    className="text-red-600 focus:text-red-600"
                                    onClick={() =>
                                      handleDeletePledge(
                                        pledge.id,
                                        pledge.description || "Untitled Pledge"
                                      )
                                    }
                                    disabled={isDeleting}
                                  >
                                    {isDeleting ? "Deleting..." : "Delete Pledge"}
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>

                        {/* Expanded Row Content */}
                        {expandedRows.has(pledge.id) && (
                          <TableRow>
                            <TableCell colSpan={10} className="bg-gray-50 p-6">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                {/* Column 1 */}
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-gray-900">
                                    Pledges Details
                                  </h4>
                                  <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">
                                        Pledges Amount:
                                      </span>
                                      <span className="font-medium">
                                        {formatCurrency(pledge.originalAmount, pledge.currency).symbol}
                                        {formatCurrency(pledge.originalAmount, pledge.currency).amount}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">
                                        Paid:
                                      </span>
                                      <span className="font-medium">
                                        {formatCurrency(pledge.totalPaid, pledge.currency).symbol}
                                        {formatCurrency(pledge.totalPaid, pledge.currency).amount}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">
                                        Balance:
                                      </span>
                                      <span className="font-medium">
                                        {formatCurrency(calculateBalance(pledge).toString(), pledge.currency).symbol}
                                        {formatCurrency(calculateBalance(pledge).toString(), pledge.currency).amount}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-gray-600">Notes:</span>
                                      <p className="mt-1 text-gray-900">
                                        {pledge.notes || "No notes available"}
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                {/* Column 2 */}
                                <div className="space-y-3">
                                  <h4 className="font-semibold text-gray-900">Payment Plan</h4>
                                  <div className="space-y-2 text-sm">
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Scheduled:</span>
                                      <span className="font-medium text-blue-600">
                                        {formatCurrency(pledge.scheduledAmount || "0", pledge.currency).symbol}
                                        {formatCurrency(pledge.scheduledAmount || "0", pledge.currency).amount}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Unscheduled:</span>
                                      <span className="font-medium text-orange-600">
                                        {formatCurrency(pledge.unscheduledAmount || "0", pledge.currency).symbol}
                                        {formatCurrency(pledge.unscheduledAmount || "0", pledge.currency).amount}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Has Payment Plan:</span>
                                      <span className={`font-medium ${getPaymentPlanStatus(pledge.scheduledAmount) === "Yes" ? "text-green-600" : "text-gray-500"
                                        }`}>
                                        {getPaymentPlanStatus(pledge.scheduledAmount)}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">First Installment:</span>
                                      <span className="font-medium">{installmentInfo.first}</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span className="text-gray-600">Last Installment:</span>
                                      <span className="font-medium">{installmentInfo.last}</span>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              {/* Action Buttons */}
                              <div className="mt-6 pt-4 flex gap-2 border-t justify-between">
                                <div className="flex gap-2">
                                  {session?.user?.role !== "user" && (
                                    <PaymentDialogClient
                                      pledgeId={pledge.id}
                                      amount={Number.parseFloat(calculateBalance(pledge).toString())}
                                      currency={pledge.currency}
                                      description={pledge.description ?? ""}
                                    />
                                  )}
                                  <LinkButton
                                    href={`/contacts/${contactId}/payments?pledgeId=${pledge.id}`}
                                    variant="outline"
                                    className="flex items-center gap-2"
                                  >
                                    <BadgeDollarSign className="h-4 w-4" />
                                    View Payments
                                  </LinkButton>
                                </div>

                                <div className="flex gap-2">
                                  {session?.user?.role !== "user" && (
                                    <PaymentPlanDialog pledgeId={pledge.id} />
                                  )}
                                  {session?.user?.role !== "user" && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleEditClick(pledge.id)}
                                    >
                                      <Edit className="mr-2 h-4 w-4" />
                                      Edit Pledge
                                    </Button>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data && data.pledges.length > 0 && (
            <div className="flex items-center justify-between mt-6">
              <div className="text-sm text-gray-600">
                Showing {(currentPage - 1) * currentLimit + 1} to{" "}
                {Math.min(currentPage * currentLimit, data.pledges.length)} of{" "}
                {data.pledges.length} pledges
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                >
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-600">Page {currentPage}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(currentPage + 1)}
                  disabled={data.pledges.length < currentLimit}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Pledge</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this pledge:{" "}
              <strong>{pledgeToDelete?.description}</strong>? This action cannot
              be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelDeletePledge}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeletePledge}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Dialog */}
      {editingPledge && (
        <PledgeDialog
          mode="edit"
          contactId={contactId as number}
          pledgeData={editingPledge}
          onPledgeUpdated={handlePledgeUpdated}
          open={editDialogOpen}
          onOpenChange={handleEditDialogChange}
          categories={categories}
        />
      )}
    </div>
  );
}