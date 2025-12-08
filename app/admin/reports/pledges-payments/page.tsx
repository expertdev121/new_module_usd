"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Filter } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

export default function PledgesPaymentsReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const filters = useMemo(() => ({
    locationId: session?.user?.locationId || "",
    categoryFilter: selectedCategory
  }), [session?.user?.locationId, selectedCategory]);

  // Server-side pagination state
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });

  // Store metadata from API
  const [pageCount, setPageCount] = useState(0);

  const columns: ColumnDef<ReportData>[] = useMemo(() => {
    if (reportData.length === 0) return [];
    return Object.keys(reportData[0]).map((header) => ({
      accessorKey: header,
      header: header,
      cell: ({ getValue }) => {
        const value = getValue() as string;
        return <span className="text-sm">{value}</span>;
      },
    }));
  }, [reportData]);

  const table = useReactTable({
    data: reportData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: true, // Enable server-side pagination
    rowCount: pageCount * pagination.pageSize, // Total rows
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

  // Load categories on mount
  useEffect(() => {
    if (session?.user?.role === "admin") {
      fetchCategories();
    }
  }, [session]);

  // Load data on component mount
  useEffect(() => {
    if (session?.user?.role === "admin" && initialLoad) {
      fetchReportData(0, 10);
      setInitialLoad(false);
    }
  }, [session, initialLoad]);

  // Load data when filters change
  useEffect(() => {
    if (session?.user?.role === "admin" && !initialLoad) {
      setPagination(prev => ({ ...prev, pageIndex: 0 })); // Reset to first page
      fetchReportData(0, 10);
    }
  }, [selectedCategory]);

  // Fetch data when pagination changes
  useEffect(() => {
    if (!initialLoad && session?.user?.role === "admin") {
      fetchReportData(pagination.pageIndex, pagination.pageSize);
    }
  }, [pagination.pageIndex, pagination.pageSize, session, initialLoad]);

  const fetchCategories = async () => {
    try {
      const response = await fetch('/api/admin/reports/pledges-payments/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          locationId: session?.user?.locationId || ""
        }),
      });

      if (response.ok) {
        const result = await response.json();
        setCategories(result.categories || []);
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
    }
  };

  const fetchReportData = async (pageIndex: number, pageSize: number) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/reports/pledges-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: filters,
          page: pageIndex + 1, // API uses 1-based indexing
          pageSize: pageSize,
          preview: true
        }),
      });

      if (response.ok) {
        const result: ApiResponse = await response.json();
        setReportData(result.data || []);
        setPageCount(result.totalPages);
      } else {
        console.error('Failed to fetch report data');
        setReportData([]);
        setPageCount(0);
      }
    } catch (error) {
      console.error('Error fetching report data:', error);
      setReportData([]);
      setPageCount(0);
    } finally {
      setLoading(false);
    }
  };

  const generateReport = async () => {
    try {
      const response = await fetch('/api/admin/reports/pledges-payments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filters: filters
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pledges-payments-${new Date().toISOString().split('T')[0]}.csv`;
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

  const handleCategoryChange = (value: string) => {
    setSelectedCategory(value);
    setPagination(prev => ({ ...prev, pageIndex: 0 })); // Reset to first page
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
        <h1 className="text-3xl font-bold">Pledges & Payments Reports</h1>
        <p className="text-muted-foreground">
          View all pledges and their associated payments, with filtering by category
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4" />
          <span className="text-sm font-medium">Filter by Category:</span>
        </div>
        <Select value={selectedCategory} onValueChange={handleCategoryChange}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Select category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>
            {categories.map((category) => (
              <SelectItem key={category} value={category}>
                {category}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Data Table */}
      {reportData.length > 0 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Pledges & Payments Data ({table.getFilteredRowModel().rows.length} records)</h2>
            <Button onClick={generateReport}>
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

      {!loading && reportData.length === 0 && !initialLoad && (
        <div className="text-center py-8 text-muted-foreground">
          No pledges and payments found for the selected filters.
        </div>
      )}
    </div>
  );
}
