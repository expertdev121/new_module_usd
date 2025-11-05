"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, DollarSign, Search } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";

interface ReportData {
  [key: string]: string;
}

export default function FinancialAccountingReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [eventCodeFilter, setEventCodeFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [filters] = useState({
    locationId: session?.user?.locationId || ""
  });

  const columns: ColumnDef<ReportData>[] = useMemo(() => {
    if (reportData.length === 0) return [];
    return Object.keys(reportData[0])
      .filter((header) => header !== 'Restricted vs. Unrestricted Funds')
      .map((header) => ({
        accessorKey: header,
        header: header,
        cell: ({ getValue }) => {
          const value = getValue() as string;
          return <span className="text-sm">{value}</span>;
        },
      }));
  }, [reportData]);

  // Server-side pagination state
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });

  // Store metadata from API
  const [totalPages, setTotalPages] = useState(0);

  const table = useReactTable({
    data: reportData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination: true, // Enable server-side pagination
    rowCount: totalPages * pagination.pageSize, // Total rows
    onPaginationChange: setPagination,
    state: {
      pagination,
    },
  });

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
    } else if (session.user.role !== "admin") {
      router.push("/contacts");
    }
  }, [session, status, router]);

  // Load all data on component mount
  useEffect(() => {
    if (session?.user?.role === "admin" && initialLoad) {
      fetchReportData(undefined, undefined, 0, 10);
      setInitialLoad(false);
    }
  }, [session, initialLoad]);

  // Fetch data when pagination changes
  useEffect(() => {
    if (!initialLoad && session?.user?.role === "admin") {
      fetchReportData(eventCodeFilter || undefined, yearFilter || undefined, pagination.pageIndex, pagination.pageSize);
    }
  }, [pagination.pageIndex, pagination.pageSize, session, initialLoad]);

  const fetchReportData = async (eventCode?: string, year?: string, pageIndex: number = 0, pageSize: number = 10) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/reports/financial-accounting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportType: "event-based-year-end",
          filters: {
            ...filters,
            eventCode: eventCode || undefined,
            year: year ? parseInt(year) : undefined,
            page: pageIndex + 1, // API uses 1-based indexing
            pageSize: pageSize,
          },
          preview: true
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setReportData(result.data || []);
        setTotalPages(result.totalPages || 0);
      } else {
        console.error('Failed to fetch report data');
        setReportData([]);
        setTotalPages(0);
      }
    } catch (error) {
      console.error('Error fetching report data:', error);
      setReportData([]);
      setTotalPages(0);
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async (eventCode?: string, year?: string) => {
    try {
      const response = await fetch('/api/admin/reports/financial-accounting', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportType: "event-based-year-end",
          filters: {
            ...filters,
            eventCode: eventCode || undefined,
            year: year ? parseInt(year) : undefined
          }
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `financial-accounting-event-based-year-end-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        console.error('Failed to generate report');
      }
    } catch (error) {
      console.error('Error generating report:', error);
    }
  };

  if (status === "loading") {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!session || session.user.role !== "admin") {
    return null; // Will redirect
  }

  const handleFilter = () => {
    setPagination({ pageIndex: 0, pageSize: 10 }); // Reset pagination when filtering
    fetchReportData(eventCodeFilter || undefined, yearFilter || undefined, 0, 10);
  };

  const clearFilter = () => {
    setEventCodeFilter("");
    setYearFilter("");
    setPagination({ pageIndex: 0, pageSize: 10 }); // Reset pagination when clearing filter
    fetchReportData(undefined, undefined, 0, 10);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Financial & Accounting Reports</h1>
        <p className="text-muted-foreground">
          Generate reports to provide a clear breakdown of donations by level, event, and time period
        </p>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center flex-wrap">
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Filter by event code..."
            value={eventCodeFilter}
            onChange={(e) => setEventCodeFilter(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="flex-1 max-w-sm">
          <Input
            placeholder="Filter by year..."
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="w-full"
          />
        </div>
        <Button onClick={handleFilter} disabled={loading}>
          <Search className="mr-2 h-4 w-4" />
          Filter
        </Button>
        <Button variant="outline" onClick={clearFilter} disabled={loading}>
          Clear
        </Button>
      </div>

      {/* Data Table */}
      {reportData.length > 0 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Event-Based Year-End Giving Report ({reportData.length} records)</h2>
            <Button onClick={() => generateReport(eventCodeFilter || undefined, yearFilter || undefined)}>
              <FileText className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
          </div>
          <DataTable table={table} />
        </div>
      )}

      {loading && (
        <div className="text-center py-8">Loading report data...</div>
      )}
    </div>
  );
}
