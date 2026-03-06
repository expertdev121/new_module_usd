"use client";

import React, { useMemo, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Search, Trash2, ArrowUp, Filter } from "lucide-react";
import { LinkButton } from "../ui/next-link";
import { useGetContacts } from "@/lib/query/useContacts";
import ContactFormDialog from "../forms/contact-form";
import ContactsSummaryCards from "./contact-summary";
import { useRouter } from "next/navigation";
import ExportDataDialog from "../export";
import { DeleteConfirmationDialog } from "../ui/delete-confirmation-dialog";
import { useDeleteContact } from "@/lib/mutation/useDeleteContact";
import { ContactResponse } from "@/lib/query/useContacts";
import EndOfYearLetterModal from "./EndOfYearLetterModal";
import { useSession } from "next-auth/react";
import {
  useReactTable,
  getCoreRowModel,
  ColumnDef,
  flexRender,
} from "@tanstack/react-table";

type QueryParamsType = {
  page: number;
  limit: number;
  search?: string;
  sortBy: "updatedAt" | "firstName" | "lastName" | "displayName" | "email" | "phone" | "totalPledgedUsd" | "totalPaidUsd" | "recentPaymentDate";
  sortOrder: "asc" | "desc";
};

const QueryParamsSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z
    .enum(["updatedAt", "firstName", "lastName", "displayName", "email", "phone", "totalPledgedUsd", "totalPaidUsd", "recentPaymentDate"])
    .default("displayName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

type FilterOption = "alphabetical" | "amount_high_low" | "recent";

const filterOptions: { value: FilterOption; label: string; sortBy: QueryParamsType['sortBy']; sortOrder: QueryParamsType['sortOrder'] }[] = [
  { value: "alphabetical", label: "Alphabetical (A-Z)", sortBy: "displayName", sortOrder: "asc" },
  { value: "amount_high_low", label: "Amount (High to Low)", sortBy: "totalPaidUsd", sortOrder: "desc" },
  { value: "recent", label: "Recent", sortBy: "recentPaymentDate", sortOrder: "desc" },
];

export default function ContactsTable({ isAdmin }: { isAdmin: boolean }) {
  const [page, setPage] = useQueryState("page", {
    parse: (value) => parseInt(value) || 1,
    serialize: (value) => value.toString(),
  });
  const [limit] = useQueryState("limit", {
    parse: (value) => parseInt(value) || 10,
    serialize: (value) => value.toString(),
  });
  const [search, setSearch] = useQueryState("search");
  const [sortByQuery, setSortByQuery] = useQueryState("sortBy");
  const [sortOrderQuery, setSortOrderQuery] = useQueryState("sortOrder");
  const [activeFilter, setActiveFilter] = useState<FilterOption>("alphabetical");
  const [filterDropdownOpen, setFilterDropdownOpen] = useState(false);

  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [letterModalOpen, setLetterModalOpen] = useState(false);

  const currentPage = page ?? 1;
  const currentLimit = limit ?? 10;

  // Use query params for sorting - get values and apply defaults
  const sortBy: QueryParamsType['sortBy'] = (sortByQuery as QueryParamsType['sortBy']) || "displayName";
  const sortOrder: QueryParamsType['sortOrder'] = (sortOrderQuery as QueryParamsType['sortOrder']) || "asc";

  // Handle filter change - this updates the URL query params
  const handleFilterChange = (option: FilterOption) => {
    const filterConfig = filterOptions.find(f => f.value === option);
    if (filterConfig) {
      // Update URL query params to trigger the API call with new sort
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set("sortBy", filterConfig.sortBy);
      newUrl.searchParams.set("sortOrder", filterConfig.sortOrder);
      window.history.pushState({}, "", newUrl.toString());
      
      // Also update local state
      setSortByQuery(filterConfig.sortBy);
      setSortOrderQuery(filterConfig.sortOrder);
      setActiveFilter(option);
      setFilterDropdownOpen(false);
    }
  };

  // Build query params for API call
  const queryParams = QueryParamsSchema.parse({
    page: currentPage,
    limit: currentLimit,
    search: search || undefined,
    sortBy,
    sortOrder,
  });

  const { data, isLoading, error } = useGetContacts(queryParams);
  const deleteContactMutation = useDeleteContact();
  const { data: session } = useSession();

  const summaryData = useMemo(() => {
    if (!data?.summary) return undefined;

    return {
      totalContacts: data.summary.totalContacts,
      totalPledgedAmount: data.summary.totalPledgedAmount,
      totalPaidAmount: data.summary.totalPaidAmount,
      contactsWithPledges: data.summary.contactsWithPledges,
      recentContacts: data.summary.recentContacts,
    };
  }, [data?.summary]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  };

  const handleDeleteClick = (contact: ContactResponse, event: React.MouseEvent) => {
    event.stopPropagation();
    setContactToDelete({
      id: contact.id,
      name: contact.displayName || `${contact.firstName} ${contact.lastName}`,
    });
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = () => {
    if (contactToDelete) {
      deleteContactMutation.mutate(contactToDelete.id, {
        onSuccess: () => {
          setDeleteDialogOpen(false);
          setContactToDelete(null);
        },
      });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setContactToDelete(null);
  };

  // Define columns - removed sorting from headers
  const columns: ColumnDef<ContactResponse>[] = [
    {
      accessorKey: "displayName",
      header: "Full Name",
      cell: ({ row }) => (
        <div className="font-medium">
          {row.original.displayName || `${row.original.firstName} ${row.original.lastName}` || "N/A"}
        </div>
      ),
    },
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ row }) => <div>{row.original.email || "N/A"}</div>,
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => <div>{row.original.phone || "N/A"}</div>,
    },
    {
      accessorKey: "totalPaidUsd",
      header: "Total Paid (USD)",
      cell: ({ row }) => <div>{formatCurrency(row.original.totalPaidUsd)}</div>,
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <LinkButton
            variant="secondary"
            href={`/contacts/${row.original.id}`}
            className="p-2 text-primary underline"
          >
            View
          </LinkButton>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => handleDeleteClick(row.original, e)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 p-2"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const table = useReactTable({
    data: data?.contacts || [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  if (error) {
    const isNoDataError = error.message?.includes("No contacts found") ||
                         data?.contacts?.length === 0;

    if (isNoDataError) {
      return (
        <Alert className="mx-4 my-6">
          <AlertDescription>
            Your data is not present. Please contact the admin.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <Alert className="mx-4 my-6">
        <AlertDescription>
          Failed to load contacts data. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="py-4">
      {isAdmin && (
        <ContactsSummaryCards
          data={summaryData}
          showViewAll={true}
          pledgesHref="/pledges"
        />
      )}
      <p className="my-2 text-muted-foreground">
        View and manage your contacts
      </p>

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
          <Input
            placeholder="Search contacts..."
            value={search || ""}
            onChange={(e) => setSearch(e.target.value || null)}
            className="pl-10 border-gray-500"
          />
        </div>

        <ContactFormDialog />
        {isAdmin && (
          <>
            <Button
              variant="outline"
              onClick={() => setLetterModalOpen(true)}
              className="flex items-center gap-2"
            >
              <ArrowUp className="h-4 w-4" />
              Year End Letters
            </Button>
            
            {/* Filter Dropdown */}
            <div className="relative">
              <Button
                variant="outline"
                onClick={() => setFilterDropdownOpen(!filterDropdownOpen)}
                className="flex items-center gap-2"
              >
                <Filter className="h-4 w-4" />
                Filter
              </Button>
              {filterDropdownOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-md shadow-lg z-10">
                  {filterOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleFilterChange(option.value)}
                      className={`block w-full text-left px-4 py-2 text-sm ${
                        activeFilter === option.value
                          ? "bg-gray-100 text-gray-900"
                          : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <ExportDataDialog
              triggerText="Export All Data"
              triggerVariant="secondary"
            />
          </>
        )}
      </div>

      {/* Table */}
      <div className="border-2 border-gray-400 rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead key={header.id} className="font-semibold text-gray-900">
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: currentLimit }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <Skeleton className="h-4 w-20" />
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
                    <Skeleton className="h-4 w-16" />
                  </TableCell>
                </TableRow>
              ))
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="hover:bg-gray-50"
                  onClick={() => {
                    router.push(`/contacts/${row.original.id}`);
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="text-center py-8 text-gray-500">
                  Your data is not present. Please contact the admin.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.contacts.length > 0 && (
        <div className="flex items-center justify-between mt-6">
          <div className="text-sm text-gray-600">
            Showing {(currentPage - 1) * currentLimit + 1} to{" "}
            {Math.min(currentPage * currentLimit, data.pagination.totalCount)}{" "}
            of {data.pagination.totalCount} contacts
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
                Page {currentPage} of {data.pagination.totalPages}
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

      <DeleteConfirmationDialog
        isOpen={deleteDialogOpen}
        onClose={handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        contactName={contactToDelete?.name || ""}
        isDeleting={deleteContactMutation.isPending}
      />

      <EndOfYearLetterModal
        isOpen={letterModalOpen}
        onClose={() => setLetterModalOpen(false)}
        locationId={session?.user?.locationId || null}
      />
    </div>
  );
}
