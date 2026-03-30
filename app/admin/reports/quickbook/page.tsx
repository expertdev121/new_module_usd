"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { DownloadButtons } from "@/components/ui/download-buttons";
import { FileText } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import DateRangePicker from "@/components/ui/date-range-picker";

interface ReportData {
  [key: string]: string | number;
}

interface ApiResponse {
  data: ReportData[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function QuickbookReportPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [filters] = useState({
    locationId: session?.user?.locationId || ""
  });

  // Server-side pagination state
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });
  
  // Store metadata from API
  const [pageCount, setPageCount] = useState(0);

  const columns: ColumnDef<ReportData>[] = useMemo(() => {
    if (reportData.length === 0) return [];
    return Object.keys(reportData[0]!).map((header) => ({
      accessorKey: header as keyof ReportData,
      header: (() => {
        const formatted = header.charAt(0).toUpperCase() + header.slice(1).replace(/([A-Z])/g, ' $1');
        return formatted;
      }) as any,
      cell: ({ getValue }) => {
        const value = getValue();
        // Safe date formatting - fix TypeScript "{}" error
        const safeValue = typeof value === 'string' ? value : String(value || '-');
        return <span className="text-sm">{safeValue}</span>;
      },
    }));
  }, [reportData]);

  const table = useReactTable({
    data: reportData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination: true,
    rowCount: pageCount * pagination.pageSize,
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

  // Load data on component mount
  useEffect(() => {
    if (session?.user?.role === "admin" && initialLoad) {
      fetchReportData(0, 10);
      setInitialLoad(false);
    }
  }, [session, initialLoad]);

  // Fetch data when pagination changes
  useEffect(() => {
    if (!initialLoad && session?.user?.role === "admin") {
      fetchReportData(pagination.pageIndex, pagination.pageSize);
    }
  }, [pagination.pageIndex, pagination.pageSize, session, initialLoad]);

  const fetchReportData = async (pageIndex: number, pageSize: number, overrideStartDate?: Date | null, overrideEndDate?: Date | null) => {
    setLoading(true);
    try {
      const effectiveStartDate = overrideStartDate !== undefined ? overrideStartDate : startDate;
      const effectiveEndDate = overrideEndDate !== undefined ? overrideEndDate : endDate;
      const response = await fetch('/api/admin/reports/quickbook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            ...filters,
            startDate: effectiveStartDate ? effectiveStartDate.toISOString().split('T')[0] : undefined,
            endDate: effectiveEndDate ? effectiveEndDate.toISOString().split('T')[0] : undefined
          },
          page: pageIndex + 1,
          pageSize: pageSize,
          preview: true
        }),
      });

      if (response.ok) {
        const result: ApiResponse = await response.json();
        setReportData(result.data || []);
        setPageCount(result.totalPages);
      } else {
        console.error('Failed to fetch Quickbook report data');
        setReportData([]);
        setPageCount(0);
      }
    } catch (error) {
      console.error('Error fetching Quickbook report data:', error);
      setReportData([]);
      setPageCount(0);
    } finally {
      setLoading(false);
    }
  };

  const handleDateRangeChange = (start: Date | null, end: Date | null) => {
    setStartDate(start);
    setEndDate(end);
    setPagination({ pageIndex: 0, pageSize: 10 });
    fetchReportData(0, 10, start, end);
  };

  const generateCsvDownload = async () => {
    try {
      const response = await fetch('/api/admin/reports/quickbook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            ...filters,
            startDate: startDate ? startDate.toISOString().split('T')[0] : undefined,
            endDate: endDate ? endDate.toISOString().split('T')[0] : undefined
          }
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `quickbook-report-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        console.error('Failed to generate CSV report');
      }
    } catch (error) {
      console.error('Error generating CSV report:', error);
    }
  };

  const generatePdfDownload = async () => {
    try {
      const response = await fetch('/api/admin/reports/quickbook/pdf', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: {
            ...filters,
            startDate: startDate ? startDate.toISOString().split('T')[0] : undefined,
            endDate: endDate ? endDate.toISOString().split('T')[0] : undefined
          }
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `quickbook-report-${new Date().toISOString().split('T')[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        console.error('Failed to generate PDF report');
      }
    } catch (error) {
      console.error('Error generating PDF report:', error);
    }
  };

  if (status === "loading") {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!session || session.user.role !== "admin") {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Quickbook Report</h1>
        <p className="text-muted-foreground">
          View all transactions for the location (GHL Contact ID, Display Name, First/Last Name, Campaign, Received Date, Amount, Method, Category)
        </p>
      </div>

      {/* Date Range Filter */}
      <div className="flex items-center gap-4">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={handleDateRangeChange}
          placeholder="Filter by received date range (optional)"
          disabled={loading}
          className="w-80"
        />
      </div>

      {/* Data Table */}
      {reportData.length > 0 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">
              Transactions ({table.getFilteredRowModel().rows.length} records)
            </h2>
            <div className="flex gap-2">
              <Button
                onClick={generateCsvDownload}
                disabled={loading}
                variant="default"
                size="sm"
              >
                <FileText className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
              <Button
                onClick={generatePdfDownload}
                disabled={loading}
                variant="outline"
                size="sm"
              >
                Download PDF
              </Button>
            </div>
          </div>
          <DataTable table={table} />
        </div>
      )}

      {loading && (
        <div className="text-center py-8">
          <div>Loading Quickbook report data...</div>
        </div>
      )}

      {!loading && reportData.length === 0 && !initialLoad && (
        <div className="text-center py-8 text-muted-foreground">
          No transactions found for the selected filters.
        </div>
      )}
    </div>
  );
}
