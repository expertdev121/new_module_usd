"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { FileText } from "lucide-react";

interface ContactDonation {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  totalDonations: number;
  mostRecentDonationDate: string | null;
  mostRecentDonationAmount: number | null;
}

const ContactsDonationsReport: React.FC = () => {
  const [contacts, setContacts] = useState<ContactDonation[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });
  const [totalPages, setTotalPages] = useState(0);
  const [sortBy, setSortBy] = useState<string>("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState<string>("");

  const columns = useMemo<ColumnDef<ContactDonation>[]>(
    () => {
      if (contacts.length === 0) return [];

      return [
        {
          accessorKey: "displayName",
          header: "Display Name",
          cell: (info) => {
            const val = info.getValue<string>();
            if (!val) return "-";
            return <span className="text-sm">{val}</span>;
          },
        },
        {
          accessorKey: "email",
          header: "Email",
          cell: (info) => {
            const val = info.getValue<string | null>();
            if (!val) return "-";
            return <span className="text-sm">{val}</span>;
          },
        },
        {
          accessorKey: "phone",
          header: "Phone Number",
          cell: (info) => {
            const val = info.getValue<string | null>();
            if (!val) return "-";
            return <span className="text-sm">{val}</span>;
          },
        },
        {
          accessorKey: "address",
          header: "Address",
          cell: (info) => {
            const val = info.getValue<string | null>();
            if (!val) return "-";
            return <span className="text-sm">{val}</span>;
          },
        },
        {
          accessorKey: "totalDonations",
          header: "Total Donations",
          cell: (info) => {
            const val = info.getValue<number>();
            if (val === undefined || val === null) return "-";
            return (
              <span className="text-sm">
                {val.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            );
          },
        },
        {
          accessorKey: "mostRecentDonationDate",
          header: "Most Recent Donation Date",
          cell: (info) => {
            const val = info.getValue<string | null>();
            if (!val) return "-";
            return (
              <span className="text-sm">
                {new Date(val).toLocaleDateString()}
              </span>
            );
          },
        },
        {
          accessorKey: "mostRecentDonationAmount",
          header: "Most Recent Donation Amount",
          cell: (info) => {
            const val = info.getValue<number | null>();
            if (val === undefined || val === null) return "-";
            return (
              <span className="text-sm">
                {val.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            );
          },
        },
      ];
    },
    [contacts]
  );

  const table = useReactTable({
    data: contacts,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination: true,
    getPaginationRowModel: getPaginationRowModel(),
    pageCount: totalPages,
    state: {
      pagination,
    },
    onPaginationChange: setPagination,
  });

  const fetchContacts = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    params.append("page", (pagination.pageIndex + 1).toString());
    params.append("limit", pagination.pageSize.toString());
    params.append("sortBy", sortBy);
    params.append("sortOrder", sortOrder);
    if (search.trim()) {
      params.append("search", search.trim());
    }
    try {
      const res = await fetch(`/api/reports/contacts-donations?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }
      const data = await res.json();
      setContacts(data.contacts);
      setTotalPages(data.pagination.totalPages);
    } catch (error) {
      console.error("Failed to fetch contacts donations report:", error);
      setContacts([]);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, [pagination.pageIndex, pagination.pageSize, sortBy, sortOrder, search]);

  const generateCSV = async () => {
    try {
      setIsDownloading(true);
      const params = new URLSearchParams();
      params.append("sortBy", sortBy);
      params.append("sortOrder", sortOrder);
      if (search.trim()) {
        params.append("search", search.trim());
      }
      const res = await fetch(`/api/reports/contacts-donations/csv?${params.toString()}`, {
        method: "GET",
      });
      if (!res.ok) {
        throw new Error(`Failed to generate CSV: ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contacts-donations-report-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center space-x-2">
        <h2 className="text-xl font-bold">Contacts Donations Report</h2>
        <Button onClick={generateCSV} disabled={loading || isDownloading} variant="default" size="sm" className="flex items-center bg-green-600 hover:bg-green-700 text-white border-green-600">
          {isDownloading ? (
            <svg
              className="animate-spin mr-2 h-4 w-4 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              ></path>
            </svg>
          ) : (
            <FileText className="mr-2 h-4 w-4" />
          )}
          Download CSV
        </Button>
      </div>
      <div>
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border px-3 py-2 rounded w-full max-w-sm"
        />
      </div>
      {loading ? (
        <p className="text-center py-8">Loading contacts...</p>
      ) : contacts.length === 0 ? (
        <p className="text-center py-8">No contacts found.</p>
      ) : (
        <DataTable table={table} />
      )}
    </div>
  );
};

export default ContactsDonationsReport;
