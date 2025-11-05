"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Target, Search, X } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  ColumnDef,
  flexRender,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import { useCampaigns } from "@/lib/query/useCampaigns";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReportData {
  [key: string]: string;
}

export default function CampaignFundraisingReportsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [reportData, setReportData] = useState<ReportData[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [selectedCampaigns, setSelectedCampaigns] = useState<number[]>([]);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [filters] = useState({
    locationId: session?.user?.locationId || ""
  });

  const { data: campaigns = [] } = useCampaigns();

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
      fetchReportData(undefined, 0, 10);
      setInitialLoad(false);
    }
  }, [session, initialLoad]);

  // Fetch data when pagination changes
  useEffect(() => {
    if (!initialLoad && session?.user?.role === "admin") {
      fetchReportData(selectedCampaigns.length > 0 ? selectedCampaigns : undefined, pagination.pageIndex, pagination.pageSize);
    }
  }, [pagination.pageIndex, pagination.pageSize, session, initialLoad]);

  const fetchReportData = async (campaignIds?: number[], pageIndex: number = 0, pageSize: number = 10) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/reports/campaign-fundraising', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportType: "event-specific",
          filters: {
            ...filters,
            campaignIds: campaignIds || undefined,
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

  const generateReport = async (campaignIds?: number[]) => {
    try {
      const response = await fetch('/api/admin/reports/campaign-fundraising', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reportType: "event-specific",
          filters: {
            ...filters,
            campaignIds: campaignIds || undefined
          }
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `campaign-fundraising-event-specific-${new Date().toISOString().split('T')[0]}.csv`;
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

  const handleCampaignFilter = () => {
    setPagination({ pageIndex: 0, pageSize: 10 }); // Reset pagination when filtering
    fetchReportData(selectedCampaigns.length > 0 ? selectedCampaigns : undefined, 0, 10);
  };

  const clearFilter = () => {
    setSelectedCampaigns([]);
    setPagination({ pageIndex: 0, pageSize: 10 }); // Reset pagination when clearing filter
    fetchReportData(undefined, 0, 10);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Campaign & Fundraising Reports</h1>
        <p className="text-muted-foreground">
          Generate reports to track fundraising effectiveness for campaigns and events
        </p>
      </div>

      {/* Campaign Filter */}
      <div className="flex gap-4 items-center">
        <div className="flex-1 max-w-sm">
          <Popover open={campaignOpen} onOpenChange={setCampaignOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={campaignOpen}
                className="w-full justify-between"
              >
                {selectedCampaigns.length > 0
                  ? `${selectedCampaigns.length} campaign${selectedCampaigns.length > 1 ? 's' : ''} selected`
                  : "Select campaigns..."}
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-full p-0">
              <Command>
                <CommandInput placeholder="Search campaigns..." />
                <CommandList>
                  <CommandEmpty>No campaigns found.</CommandEmpty>
                  <CommandGroup>
                    {campaigns.map((campaign) => (
                      <CommandItem
                        key={campaign.id}
                        onSelect={() => {
                          setSelectedCampaigns(prev =>
                            prev.includes(campaign.id)
                              ? prev.filter(id => id !== campaign.id)
                              : [...prev, campaign.id]
                          );
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedCampaigns.includes(campaign.id) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {campaign.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <Button onClick={handleCampaignFilter} disabled={loading}>
          <Search className="mr-2 h-4 w-4" />
          Filter
        </Button>
        <Button variant="outline" onClick={clearFilter} disabled={loading}>
          Clear
        </Button>
      </div>

      {/* Selected Campaigns Display */}
      {selectedCampaigns.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedCampaigns.map((campaignId) => {
            const campaign = campaigns.find(c => c.id === campaignId);
            return (
              <Badge key={campaignId} variant="secondary" className="flex items-center gap-1">
                {campaign?.name}
                <X
                  className="h-3 w-3 cursor-pointer"
                  onClick={() => setSelectedCampaigns(prev => prev.filter(id => id !== campaignId))}
                />
              </Badge>
            );
          })}
        </div>
      )}

      {/* Data Table */}
      {reportData.length > 0 && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Report Data ({reportData.length} records)</h2>
            <Button onClick={() => generateReport(selectedCampaigns.length > 0 ? selectedCampaigns : undefined)}>
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
