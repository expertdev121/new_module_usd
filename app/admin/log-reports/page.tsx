"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { DataTable } from "@/components/data-table/data-table";
import { useAdminAuditLogs, type AuditLogEntry, type AuditLogQueryParams } from "@/lib/query/useAdminAuditLogs";
import { useToast } from "@/hooks/use-toast";
import { Download } from "lucide-react";
import { useReactTable, getCoreRowModel, type PaginationState } from "@tanstack/react-table";
import { columns } from "./audit-logs-columns";

export default function LogReportsPage() {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [filters, setFilters] = useState<Partial<AuditLogQueryParams>>({
    action: undefined,
    userEmail: undefined,
    dateFrom: undefined,
    dateTo: undefined,
  });
  const { toast } = useToast();

  const queryParams: AuditLogQueryParams = {
    page,
    limit,
    ...filters,
  };

  const { data, isLoading, error } = useAdminAuditLogs(queryParams);

  const table = useReactTable<AuditLogEntry>({
    data: data?.logs ?? [],
    columns,
    pageCount: data?.pagination.totalPages ?? 0,
    state: {
      pagination: {
        pageIndex: page - 1,
        pageSize: limit,
      },
    },
    onPaginationChange: (updater: PaginationState | ((old: PaginationState) => PaginationState)) => {
      const newState =
        typeof updater === "function"
          ? updater({ pageIndex: page - 1, pageSize: limit })
          : updater;
      setPage(newState.pageIndex + 1);
      setLimit(newState.pageSize);
    },
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const handleExport = async () => {
    try {
      const queryParamsStr = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString(),
        ...(filters.action && { action: filters.action }),
        ...(filters.userEmail && { userEmail: filters.userEmail }),
        ...(filters.dateFrom && { dateFrom: filters.dateFrom }),
        ...(filters.dateTo && { dateTo: filters.dateTo }),
      }).toString();

      const response = await fetch(`/api/admin/log-reports/export?${queryParamsStr}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `audit-logs-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        toast({ title: "Error", description: "Failed to export logs", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Failed to export logs", variant: "destructive" });
    }
  };

  if (error) {
    return <div className="p-6 text-destructive">Failed to load logs</div>;
  }

  if (isLoading) {
    return <div className="flex justify-center items-center h-64">Loading...</div>;
  }

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-3xl font-bold">Audit Log Reports</h1>
        <Button onClick={handleExport}>
          <Download className="mr-2 h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Action</label>
              <Select
                value={filters.action ?? "all"}
                onValueChange={(value) =>
                  setFilters({ ...filters, action: value === "all" ? undefined : value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All actions" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="login">Login</SelectItem>
                  <SelectItem value="logout">Logout</SelectItem>
                  <SelectItem value="create">Create</SelectItem>
                  <SelectItem value="update">Update</SelectItem>
                  <SelectItem value="delete">Delete</SelectItem>
                  <SelectItem value="MERGE_CONTACTS">Merge Contacts</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">User Email</label>
              <Input
                placeholder="Search by email"
                value={filters.userEmail ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, userEmail: e.target.value || undefined })
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">From Date</label>
              <Input
                type="date"
                value={filters.dateFrom ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, dateFrom: e.target.value || undefined })
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">To Date</label>
              <Input
                type="date"
                value={filters.dateTo ?? ""}
                onChange={(e) =>
                  setFilters({ ...filters, dateTo: e.target.value || undefined })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Audit Logs Table */}
      <Card>
        <CardHeader>
          <CardTitle>Audit Logs</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-0">
          <DataTable table={table} />
        </CardContent>
      </Card>
    </div>
  );
}