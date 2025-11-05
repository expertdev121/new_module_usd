"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Calendar } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";

interface ReportData {
  [key: string]: string;
}

interface ApiResponse {
  data: ReportData[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function LYBUNTSYBUNTReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [lybuntData, setLybuntData] = useState<ReportData[]>([]);
  const [sybuntData, setSybuntData] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [activeTab, setActiveTab] = useState<"lybunt" | "sybunt">("lybunt");
  const [filters] = useState({
    locationId: session?.user?.locationId || ""
  });

  // Server-side pagination state
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });

  // Store metadata from API
  const [lybuntPageCount, setLybuntPageCount] = useState(0);
  const [sybuntPageCount, setSybuntPageCount] = useState(0);

  const columns: ColumnDef<ReportData>[] = useMemo(() => {
    const data = activeTab === "lybunt" ? lybuntData : sybuntData;
    if (data.length === 0) return [];
    return Object.keys(data[0]).map((header) => ({
      accessorKey: header,
      header: header,
      cell: ({ getValue }) => {
        const value = getValue() as string;
        return <span className="text-sm">{value}</span>;
      },
    }));
  }, [lybuntData, sybuntData, activeTab]);

  const table = useReactTable({
    data: activeTab === "lybunt" ? lybuntData : sybuntData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination: true, // Enable server-side pagination
    rowCount: activeTab === "lybunt" ? lybuntPageCount * pagination.pageSize : sybuntPageCount * pagination.pageSize, // Total rows
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
      fetchReportData("lybunt", 0, 10);
      fetchReportData("sybunt", 0, 10);
      setInitialLoad(false);
    }
  }, [session, initialLoad]);

  // Fetch data when pagination changes
  useEffect(() => {
    if (!initialLoad && session?.user?.role === "admin") {
      fetchReportData(activeTab, pagination.pageIndex, pagination.pageSize);
    }
  }, [pagination.pageIndex, pagination.pageSize, activeTab, session, initialLoad]);

  const fetchReportData = async (reportType: "lybunt" | "sybunt", pageIndex: number, pageSize: number) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/reports/lybunt-sybunt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportType,
          filters: {
            ...filters,
            page: pageIndex + 1, // API uses 1-based indexing
            pageSize: pageSize,
          },
          preview: true
        }),
      });

      if (response.ok) {
        const result: ApiResponse = await response.json();
        if (reportType === "lybunt") {
          setLybuntData(result.data || []);
          setLybuntPageCount(result.totalPages);
        } else {
          setSybuntData(result.data || []);
          setSybuntPageCount(result.totalPages);
        }
      } else {
        console.error(`Failed to fetch ${reportType} report data`);
        if (reportType === "lybunt") {
          setLybuntData([]);
          setLybuntPageCount(0);
        } else {
          setSybuntData([]);
          setSybuntPageCount(0);
        }
      }
    } catch (error) {
      console.error(`Error fetching ${reportType} report data:`, error);
      if (reportType === "lybunt") {
        setLybuntData([]);
        setLybuntPageCount(0);
      } else {
        setSybuntData([]);
        setSybuntPageCount(0);
      }
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async (reportType: "lybunt" | "sybunt") => {
    try {
      const response = await fetch('/api/admin/reports/lybunt-sybunt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportType,
          filters
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lybunt-sybunt-${reportType}-${new Date().toISOString().split('T')[0]}.csv`;
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">LYBUNT & SYBUNT Reports</h1>
        <p className="text-muted-foreground">
          Track donors who gave last year but not this year, and donors who gave in the past but not this year
        </p>
      </div>

      {/* Tab Selection */}
      <div className="flex gap-4">
        <Button
          variant={activeTab === "lybunt" ? "default" : "outline"}
          onClick={() => {
            setActiveTab("lybunt");
            setPagination({ pageIndex: 0, pageSize: 10 }); // Reset pagination when switching tabs
          }}
        >
          LYBUNT Reports ({lybuntPageCount * pagination.pageSize} donors)
        </Button>
        <Button
          variant={activeTab === "sybunt" ? "default" : "outline"}
          onClick={() => {
            setActiveTab("sybunt");
            setPagination({ pageIndex: 0, pageSize: 10 }); // Reset pagination when switching tabs
          }}
        >
          SYBUNT Reports ({sybuntPageCount * pagination.pageSize} donors)
        </Button>
      </div>

      {/* Data Table */}
      {(activeTab === "lybunt" ? lybuntData : sybuntData).length > 0 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">
              {activeTab === "lybunt" ? "LYBUNT" : "SYBUNT"} Report ({(activeTab === "lybunt" ? lybuntPageCount : sybuntPageCount) * pagination.pageSize} donors)
            </h2>
            <Button onClick={() => generateReport(activeTab)}>
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
