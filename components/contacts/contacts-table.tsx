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
import { Search, Trash2, ArrowUp, Filter, Copy, Check } from "lucide-react";
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
import { toast } from "sonner";
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
  startDate?: string;
  endDate?: string;
};

const QueryParamsSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  sortBy: z
    .enum(["updatedAt", "firstName", "lastName", "displayName", "email", "phone", "totalPledgedUsd", "totalPaidUsd", "recentPaymentDate"])
    .default("recentPaymentDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

type FilterOption = "alphabetical" | "amount_high_low" | "recent" | "last_3_months";

const filterOptions: {
  value: FilterOption;
  label: string;
  sortBy: QueryParamsType["sortBy"];
  sortOrder: QueryParamsType["sortOrder"];
  applyLastThreeMonths?: boolean;
}[] = [
  { value: "alphabetical", label: "Alphabetical (A-Z)", sortBy: "lastName", sortOrder: "asc" },
  { value: "amount_high_low", label: "Amount (High to Low)", sortBy: "totalPaidUsd", sortOrder: "desc" },
  { value: "recent", label: "Most Recent Donations", sortBy: "recentPaymentDate", sortOrder: "desc" },
  { value: "last_3_months", label: "Last 3 Months", sortBy: "recentPaymentDate", sortOrder: "desc", applyLastThreeMonths: true },
];

const formatDateParam = (date: Date) => date.toISOString().split("T")[0];

const parseDateParam = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const getLastThreeMonthsStartDate = () => {
  const date = new Date();
  date.setMonth(date.getMonth() - 3);
  return formatDateParam(date);
};

const getTodayDate = () => formatDateParam(new Date());

/* Inline email cell with a copy-on-hover icon. The copy button stops
   propagation so clicking it does NOT trigger the row's onClick (which
   navigates to the contact detail page). The icon morphs into a check for
   ~1.5s after a successful copy as immediate visual confirmation. */
function EmailCell({ email }: { email: string | null | undefined }) {
  const [copied, setCopied] = useState(false);

  if (!email) return <span className="text-muted-foreground">N/A</span>;

  const handleCopy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(email);
      setCopied(true);
      toast.success("Email copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy email");
    }
  };

  return (
    <div className="group/email flex items-center gap-2">
      <span className="truncate">{email}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Email copied" : "Copy email"}
        className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover/email:opacity-100 focus-visible:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}

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
  const [startDateQuery, setStartDateQuery] = useQueryState("startDate");
  const [endDateQuery, setEndDateQuery] = useQueryState("endDate");
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
  const startDate = startDateQuery ?? undefined;
  const endDate = endDateQuery ?? undefined;

  // Use query params for sorting - get values and apply defaults
  const sortBy: QueryParamsType['sortBy'] = (sortByQuery as QueryParamsType['sortBy']) || "recentPaymentDate";
  const sortOrder: QueryParamsType['sortOrder'] = (sortOrderQuery as QueryParamsType['sortOrder']) || "desc";
  const activeFilter =
    filterOptions.find((option) => {
      const matchesSort = option.sortBy === sortBy && option.sortOrder === sortOrder;
      if (!matchesSort) return false;

      if (option.applyLastThreeMonths) {
        return startDate === getLastThreeMonthsStartDate() && endDate === getTodayDate();
      }

      return !startDate && !endDate;
    })?.value || "recent";

  // Handle filter change - this updates the URL query params
  const handleFilterChange = async (option: FilterOption) => {
    const filterConfig = filterOptions.find(f => f.value === option);
    if (filterConfig) {
      const nextStartDate = filterConfig.applyLastThreeMonths ? getLastThreeMonthsStartDate() : null;
      const nextEndDate = filterConfig.applyLastThreeMonths ? getTodayDate() : null;

      await Promise.all([
        setSortByQuery(filterConfig.sortBy),
        setSortOrderQuery(filterConfig.sortOrder),
        setStartDateQuery(nextStartDate),
        setEndDateQuery(nextEndDate),
        setPage(1),
      ]);
      setFilterDropdownOpen(false);
    }
  };

  // Build query params for API call
  const queryParams = QueryParamsSchema.parse({
    page: currentPage,
    limit: currentLimit,
    search: search || undefined,
    startDate: startDate || undefined,
    endDate: endDate || undefined,
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
      cell: ({ row }) => <EmailCell email={row.original.email} />,
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => <div>{row.original.phone || "N/A"}</div>,
    },
    {
      id: "tags",
      header: "Tags",
      cell: ({ row }) => {
        const tags = row.original.tags || [];
        if (tags.length === 0) return <span className="text-muted-foreground text-xs">No tags</span>;
        // List view: clip to 3 pills + a "+N total" count so heavily-tagged
        // contacts do not blow out the row height and wreck the table
        // rhythm. Admins who need to see every tag can click into the
        // contact detail page (Contact Information card renders them all).
        const shown = tags.slice(0, 3);
        const extra = tags.length - shown.length;
        return (
          <div className="flex flex-wrap gap-1 max-w-xs">
            {shown.map((tag: any) => (
              <span
                key={tag.id}
                className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded-full"
              >
                {tag.name}
              </span>
            ))}
            {extra > 0 && (
              <span
                className="text-xs text-muted-foreground"
                title={tags.map((t: any) => t.name).join(", ")}
              >
                +{extra} more
              </span>
            )}
          </div>
        );
      },
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
        <Alert className="mx-4 my-4">
          <AlertDescription>
            Your data is not present. Please contact the admin.
          </AlertDescription>
        </Alert>
      );
    }

    return (
      <Alert className="mx-4 my-4">
        <AlertDescription>
          Failed to load contacts data. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div>
      {isAdmin && (
        <ContactsSummaryCards
          data={summaryData}
          showViewAll={true}
          pledgesHref="/pledges"
        />
      )}

      {/* Toolbar: search + actions, no longer needing the "View and manage"
         description (the page heading + sub-line already provide context). */}
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search contacts..."
            value={search || ""}
            onChange={(e) => setSearch(e.target.value || null)}
            className="h-9 pl-9"
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

      {/* Table — single subtle border, white background lifts off the gray
         page. overflow-hidden clips the rounded corners cleanly. */}
      <div className="overflow-hidden rounded-lg border bg-card">
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
                  className="cursor-pointer transition-colors hover:bg-muted/50"
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
        <div className="flex items-center justify-between mt-4">
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
