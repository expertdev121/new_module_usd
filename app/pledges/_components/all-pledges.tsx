 /* eslint-disable @typescript-eslint/no-explicit-any */
  "use client";

  import React from "react";
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
  import { MoreHorizontal, Search } from "lucide-react";

  import Link from "next/link";
  import { useAllPledgesQuery } from "@/lib/query/pledge/useAllPledgeQuery";

  const QueryParamsSchema = z.object({
    categoryId: z.number().positive().nullable().optional(),
    page: z.number().min(1).default(1),
    limit: z.number().min(1).max(100).default(10),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    status: z.enum(["fullyPaid", "partiallyPaid", "unpaid"]).optional(),
    search: z.string().optional(),
  });

  type StatusType = "fullyPaid" | "partiallyPaid" | "unpaid";

  export default function AllPledgesTable() {
    const [categoryId] = useQueryState("categoryId", {
      parse: (value) => {
        if (!value) return null;
        const parsed = parseInt(value);
        return isNaN(parsed) ? null : parsed;
      },
      serialize: (value) =>
        value !== null && value !== undefined ? value.toString() : "",
    });
    const [page, setPage] = useQueryState("page", {
      parse: (value) => parseInt(value) || 1,
      serialize: (value) => value.toString(),
    });
    const [limit] = useQueryState("limit", {
      parse: (value) => parseInt(value) || 10,
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

    const queryParams = QueryParamsSchema.parse({
      categoryId: categoryId !== null ? categoryId : undefined,
      page: currentPage,
      limit: currentLimit,
      search: search || undefined,
      status: status || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    });

    const { data, isLoading, error } = useAllPledgesQuery(queryParams as any);

    const formatCurrency = (amount: string, currency: string) => {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(parseFloat(amount));
    };

    const formatDate = (dateString: string) => {
      return new Date(dateString).toLocaleDateString();
    };

    const getProgressColor = (percentage: number) => {
      if (percentage >= 100) return "bg-green-500";
      if (percentage >= 75) return "bg-blue-500";
      if (percentage >= 50) return "bg-yellow-500";
      return "bg-red-500";
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
            <CardTitle>Pledges</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              {/* Search */}
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder="Search Pledges, contacts..."
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
                  <SelectItem value="fullyPaid">Fully Paid</SelectItem>
                  <SelectItem value="partiallyPaid">Partially Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-semibold text-gray-900">
                      Pledge Date
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900">
                      Pledge Detail
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900">
                      Pledge Amount
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900">
                      Paid
                    </TableHead>
                    <TableHead className="font-semibold text-red-400">
                      Balance
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900">
                      Progress
                    </TableHead>
                    <TableHead className="font-semibold text-gray-900">
                      Notes
                    </TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    // Loading skeleton with safe limit value
                    Array.from({ length: currentLimit }).map((_, index) => (
                      <TableRow key={index}>
                        <TableCell>
                          <Skeleton className="h-4 w-4" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-32" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-4" />
                        </TableCell>
                      </TableRow>
                    ))
                  ) : data?.pledges.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="text-center py-8 text-gray-500"
                      >
                        No Pledges found
                      </TableCell>
                    </TableRow>
                  ) : (
                    data?.pledges.map((pledge) => (
                      <React.Fragment key={pledge.id}>
                        <TableRow className="hover:bg-gray-50">
                          <TableCell className="font-medium">
                            {formatDate(pledge.pledgeDate)}
                          </TableCell>
                          <TableCell>
                            {pledge.categoryName?.split(" ")[0]} {">"}{" "}
                            {pledge.description || "-"}
                          </TableCell>
                          <TableCell>
                            {formatCurrency(
                              pledge.originalAmount,
                              pledge.currency
                            )}
                          </TableCell>
                          <TableCell>
                            {formatCurrency(pledge.totalPaid, pledge.currency)}
                          </TableCell>
                          <TableCell>
                            {formatCurrency(pledge.balance, pledge.currency)}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div className="w-16 bg-gray-200 rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full ${getProgressColor(
                                    pledge.progressPercentage
                                  )}`}
                                  style={{
                                    width: `${Math.min(
                                      pledge.progressPercentage,
                                      100
                                    )}%`,
                                  }}
                                />
                              </div>
                              <span className="text-sm text-gray-600">
                                {pledge.progressPercentage}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="font-medium">
                            {pledge.notes}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="p-1">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem>
                                  <Link href={`/contacts/${pledge.contactId}`}>
                                    View Contact
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Link
                                    href={`/contacts/${pledge.contactId}/payments?pledgeId=${pledge.id}`}
                                  >
                                    View Payments
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem>
                                  <Link
                                    href={`/contacts/${pledge.contactId}/payment-plans?pledgeId=${pledge.id}`}
                                  >
                                    View Payment Plans
                                  </Link>
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      </React.Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            {data && data.pagination && (
              <div className="flex items-center justify-between mt-6">
                <div className="text-sm text-gray-600">
                  Showing {(data.pagination.currentPage - 1) * currentLimit + 1}{" "}
                  to{" "}
                  {Math.min(
                    data.pagination.currentPage * currentLimit,
                    data.pagination.totalCount
                  )}{" "}
                  of {data.pagination.totalCount} Pledges
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(currentPage - 1)}
                    disabled={!data.pagination.hasPreviousPage}
                  >
                    Previous
                  </Button>
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-gray-600">
                      Page {data.pagination.currentPage} of{" "}
                      {data.pagination.totalPages}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(currentPage + 1)}
                    disabled={!data.pagination.hasNextPage}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }
