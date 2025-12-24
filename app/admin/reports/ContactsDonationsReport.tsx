"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DownloadButtons } from "@/components/ui/download-buttons";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { FileText } from "lucide-react";
import DateRangePicker from "@/components/ui/date-range-picker";

interface ContactDonation {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  totalDonations: number;
  mostRecentDonationDate: string | null;
  mostRecentDonationAmount: number | null;
}

const ContactsDonationsReport: React.FC = () => {
  const formatDateForAPI = (date: Date | null) => {
    if (!date) return null;
    return date.toISOString().split('T')[0];
  };
  const [contacts, setContacts] = useState<ContactDonation[]>([]);
  const [loading, setLoading] = useState(false);
  const [isCsvDownloading, setIsCsvDownloading] = useState(false);
  const [isPdfDownloading, setIsPdfDownloading] = useState(false);
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });
  const [totalPages, setTotalPages] = useState(0);
  const [sortBy, setSortBy] = useState<string>("updatedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState<string>("");
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  const columns = useMemo<ColumnDef<ContactDonation>[]>(
    () => {
      if (contacts.length === 0) return [];

      return [
        {
          accessorKey: "firstName",
          header: "First Name",
          cell: (info) => {
            const val = info.getValue<string | null>();
            if (!val) return "-";
            return <span className="text-sm">{val}</span>;
          },
        },
        {
          accessorKey: "lastName",
          header: "Last Name",
          cell: (info) => {
            const val = info.getValue<string | null>();
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
      const formattedStartDate = formatDateForAPI(startDate);
      const formattedEndDate = formatDateForAPI(endDate);
      if (formattedStartDate) {
        params.append("startDate", formattedStartDate);
      }
      if (formattedEndDate) {
        params.append("endDate", formattedEndDate);
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
  }, [pagination.pageIndex, pagination.pageSize, sortBy, sortOrder, search, startDate, endDate]);

  const generateCsvDownload = async () => {
    try {
      setIsCsvDownloading(true);
      const params = new URLSearchParams();
      params.append("sortBy", sortBy);
      params.append("sortOrder", sortOrder);
      if (search.trim()) {
        params.append("search", search.trim());
      }
      const formattedStartDate = formatDateForAPI(startDate);
      const formattedEndDate = formatDateForAPI(endDate);
      if (formattedStartDate) {
        params.append("startDate", formattedStartDate);
      }
      if (formattedEndDate) {
        params.append("endDate", formattedEndDate);
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
      setIsCsvDownloading(false);
    }
  };

  const generatePdfDownload = async () => {
    try {
      setIsPdfDownloading(true);
      const params = new URLSearchParams();
      params.append("sortBy", sortBy);
      params.append("sortOrder", sortOrder);
      if (search.trim()) {
        params.append("search", search.trim());
      }
      const formattedStartDate = formatDateForAPI(startDate);
      const formattedEndDate = formatDateForAPI(endDate);
      if (formattedStartDate) {
        params.append("startDate", formattedStartDate);
      }
      if (formattedEndDate) {
        params.append("endDate", formattedEndDate);
      }
      const res = await fetch(`/api/reports/contacts-donations/pdf?${params.toString()}`, {
        method: "GET",
      });
      if (!res.ok) {
        throw new Error(`Failed to generate PDF: ${res.status}`);
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `contacts-donations-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
    } finally {
      setIsPdfDownloading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center space-x-2">
        <h2 className="text-xl font-bold">Contacts Donations Report</h2>
        <DownloadButtons
          onCsvDownload={generateCsvDownload}
          onPdfDownload={generatePdfDownload}
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          placeholder="Search contacts..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border px-3 py-2 rounded w-64"
        />
        <div className="w-64">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onChange={(start, end) => {
              setStartDate(start);
              setEndDate(end);
            }}
            placeholder="Select date range"
          />
        </div>
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