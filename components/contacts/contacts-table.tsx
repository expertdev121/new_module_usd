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
import { Search, Trash2, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { LinkButton } from "../ui/next-link";
import { useGetContacts } from "@/lib/query/useContacts";
import ContactFormDialog from "../forms/contact-form";
import ContactsSummaryCards from "./contact-summary";
import { useRouter } from "next/navigation";
import ExportDataDialog from "../export";
import { DeleteConfirmationDialog } from "../ui/delete-confirmation-dialog";
import { useDeleteContact } from "@/lib/mutation/useDeleteContact";
import { ContactResponse } from "@/lib/query/useContacts";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  ColumnDef,
  flexRender,
} from "@tanstack/react-table";

const QueryParamsSchema = z.object({
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z
    .enum(["updatedAt", "firstName", "lastName", "displayName", "email", "phone", "totalPledgedUsd", "totalPaidUsd"])
    .default("displayName"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

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
  const [sorting, setSorting] = useState<SortingState>([]);

  const router = useRouter();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [contactToDelete, setContactToDelete] = useState<{
    id: number;
    name: string;
  } | null>(null);

  const currentPage = page ?? 1;
  const currentLimit = limit ?? 10;

  // Determine sortBy and sortOrder from TanStack sorting state
  const sortBy = sorting.length > 0 ? sorting[0].id : "displayName";
  const sortOrder = sorting.length > 0 ? (sorting[0].desc ? "desc" : "asc") : "asc";

  const queryParams = QueryParamsSchema.parse({
    page: currentPage,
    limit: currentLimit,
    search: search || undefined,
    sortBy: sortBy as any,
    sortOrder: sortOrder as any,
  });

  const { data, isLoading, error } = useGetContacts(queryParams);
  const deleteContactMutation = useDeleteContact();

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
    event.stopPropagation(); // Prevent row click navigation
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

  // Define columns for TanStack Table
  const columns: ColumnDef<ContactResponse>[] = [
    {
      accessorKey: "displayName",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-auto p-0 font-semibold text-gray-900 hover:bg-transparent"
          >
            Full Name
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => (
        <div className="font-medium">
          {row.original.displayName || `${row.original.firstName} ${row.original.lastName}` || "N/A"}
        </div>
      ),
    },
    {
      accessorKey: "email",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-auto p-0 font-semibold text-gray-900 hover:bg-transparent"
          >
            Email
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => <div>{row.original.email || "N/A"}</div>,
    },
    {
      accessorKey: "phone",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-auto p-0 font-semibold text-gray-900 hover:bg-transparent"
          >
            Phone
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
      cell: ({ row }) => <div>{row.original.phone || "N/A"}</div>,
    },
    {
      accessorKey: "totalPaidUsd",
      header: ({ column }) => {
        return (
          <Button
            variant="ghost"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
            className="h-auto p-0 font-semibold text-gray-900 hover:bg-transparent"
          >
            Total Paid (USD)
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        );
      },
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
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    state: {
      sorting,
    },
  });

  if (error) {
    // Check if it's a 401 or specific error indicating no contact data
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
        {/* <ExportDataDialog
          triggerText="Export All Data"
          triggerVariant="secondary"
        /> */}
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
    </div>
  );
}
