"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { FileText, Search, X, Check, ChevronsUpDown } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";
import DateRangePicker from "@/components/ui/date-range-picker";
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
import { cn } from "@/lib/utils";

interface ReportData {
  [key: string]: string | number;
}

interface ContactOption {
  id: number;
  displayName: string;
  firstName: string;
  lastName: string;
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
  const [selectedContactIds, setSelectedContactIds] = useState<number[]>([]);
  const [selectedCampaigns, setSelectedCampaigns] = useState<string[]>([]);
  const [contactOptions, setContactOptions] = useState<ContactOption[]>([]);
  const [contactSearch, setContactSearch] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [filters] = useState({
    locationId: session?.user?.locationId || "",
  });

  const { data: campaigns = [] } = useCampaigns();

  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });
  const [pageCount, setPageCount] = useState(0);

  const columns: ColumnDef<ReportData>[] = useMemo(() => {
    if (reportData.length === 0) return [];
    return Object.keys(reportData[0]!).map((header) => ({
      accessorKey: header as keyof ReportData,
      header: (() => {
        const formatted = header.charAt(0).toUpperCase() + header.slice(1).replace(/([A-Z])/g, " $1");
        return formatted;
      }) as never,
      cell: ({ getValue }) => {
        const value = getValue();
        const safeValue = typeof value === "string" ? value : String(value || "-");
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

  useEffect(() => {
    if (session?.user?.role === "admin" && initialLoad) {
      fetchReportData(0, 10);
      setInitialLoad(false);
    }
  }, [session, initialLoad]);

  useEffect(() => {
    if (!initialLoad && session?.user?.role === "admin") {
      fetchReportData(pagination.pageIndex, pagination.pageSize);
    }
  }, [pagination.pageIndex, pagination.pageSize, session, initialLoad]);

  useEffect(() => {
    if (!session?.user?.role || !contactOpen) return;

    const controller = new AbortController();

    const fetchContacts = async () => {
      try {
        const params = new URLSearchParams();
        if (contactSearch.trim()) {
          params.set("search", contactSearch.trim());
        }

        const response = await fetch(`/api/admin/reports/contacts?${params.toString()}`, {
          signal: controller.signal,
        });

        if (!response.ok) return;

        const result = await response.json();
        setContactOptions(result.contacts || []);
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          console.error("Error fetching contact options:", error);
        }
      }
    };

    fetchContacts();
    return () => controller.abort();
  }, [contactSearch, contactOpen, session]);

  const buildFilterPayload = (overrideStartDate?: Date | null, overrideEndDate?: Date | null) => {
    const effectiveStartDate = overrideStartDate !== undefined ? overrideStartDate : startDate;
    const effectiveEndDate = overrideEndDate !== undefined ? overrideEndDate : endDate;

    return {
      ...filters,
      contactIds: selectedContactIds.length > 0 ? selectedContactIds : undefined,
      campaigns: selectedCampaigns.length > 0 ? selectedCampaigns : undefined,
      startDate: effectiveStartDate ? effectiveStartDate.toISOString().split("T")[0] : undefined,
      endDate: effectiveEndDate ? effectiveEndDate.toISOString().split("T")[0] : undefined,
    };
  };

  const fetchReportData = async (
    pageIndex: number,
    pageSize: number,
    overrideStartDate?: Date | null,
    overrideEndDate?: Date | null
  ) => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/reports/quickbook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filters: buildFilterPayload(overrideStartDate, overrideEndDate),
          page: pageIndex + 1,
          pageSize,
          preview: true,
        }),
      });

      if (response.ok) {
        const result: ApiResponse = await response.json();
        setReportData(result.data || []);
        setPageCount(result.totalPages);
      } else {
        console.error("Failed to fetch Quickbook report data");
        setReportData([]);
        setPageCount(0);
      }
    } catch (error) {
      console.error("Error fetching Quickbook report data:", error);
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
      const response = await fetch("/api/admin/reports/quickbook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filters: buildFilterPayload(),
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `quickbook-report-${new Date().toISOString().split("T")[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        console.error("Failed to generate CSV report");
      }
    } catch (error) {
      console.error("Error generating CSV report:", error);
    }
  };

  const generatePdfDownload = async () => {
    try {
      const response = await fetch("/api/admin/reports/quickbook/pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filters: buildFilterPayload(),
        }),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `quickbook-report-${new Date().toISOString().split("T")[0]}.pdf`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      } else {
        console.error("Failed to generate PDF report");
      }
    } catch (error) {
      console.error("Error generating PDF report:", error);
    }
  };

  if (status === "loading") {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!session || session.user.role !== "admin") {
    return null;
  }

  const selectedContactOptions = selectedContactIds
    .map((contactId) => contactOptions.find((contact) => contact.id === contactId))
    .filter((contact): contact is ContactOption => Boolean(contact));

  const handleApplyFilters = () => {
    setPagination({ pageIndex: 0, pageSize: 10 });
    fetchReportData(0, 10);
  };

  const handleClearFilters = () => {
    setSelectedContactIds([]);
    setSelectedCampaigns([]);
    setContactSearch("");
    setPagination({ pageIndex: 0, pageSize: 10 });
    fetchReportData(0, 10);
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold">Quickbook Report</h1>
        <p className="text-muted-foreground">
          View all transactions for the location (GHL Contact ID, Email, Display Name, First/Last Name, Campaign, Received Date, Amount, Method, Category)
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onChange={handleDateRangeChange}
          placeholder="Date range"
          disabled={loading}
          className="w-full"
        />

        <Popover open={contactOpen} onOpenChange={setContactOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={contactOpen}
              className="w-full justify-between"
            >
              {selectedContactIds.length > 0
                ? `${selectedContactIds.length} name${selectedContactIds.length > 1 ? "s" : ""} selected`
                : "Select names..."}
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full p-0">
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search names..."
                value={contactSearch}
                onValueChange={setContactSearch}
              />
              <CommandList>
                <CommandEmpty>No contacts found.</CommandEmpty>
                <CommandGroup>
                  {contactOptions.map((contact) => {
                    const label = contact.displayName || `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
                    return (
                      <CommandItem
                        key={contact.id}
                        onSelect={() => {
                          setSelectedContactIds((prev) =>
                            prev.includes(contact.id)
                              ? prev.filter((id) => id !== contact.id)
                              : [...prev, contact.id]
                          );
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedContactIds.includes(contact.id) ? "opacity-100" : "opacity-0"
                          )}
                        />
                        {label}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Popover open={campaignOpen} onOpenChange={setCampaignOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={campaignOpen}
              className="w-full justify-between"
            >
              {selectedCampaigns.length > 0
                ? `${selectedCampaigns.length} campaign${selectedCampaigns.length > 1 ? "s" : ""} selected`
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
                  {campaigns
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((campaign) => (
                      <CommandItem
                        key={campaign.id}
                        onSelect={() => {
                          setSelectedCampaigns((prev) =>
                            prev.includes(campaign.name)
                              ? prev.filter((name) => name !== campaign.name)
                              : [...prev, campaign.name]
                          );
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedCampaigns.includes(campaign.name) ? "opacity-100" : "opacity-0"
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

      <div className="flex gap-3">
        <Button onClick={handleApplyFilters} disabled={loading}>
          <Search className="mr-2 h-4 w-4" />
          Filter
        </Button>
        <Button variant="outline" onClick={handleClearFilters} disabled={loading}>
          Clear
        </Button>
      </div>

      {(selectedContactOptions.length > 0 || selectedCampaigns.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {selectedContactOptions.map((contact) => {
            const label = contact.displayName || `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
            return (
              <Badge key={`contact-${contact.id}`} variant="secondary" className="flex items-center gap-1 pr-1">
                {label}
                <button
                  type="button"
                  className="ml-1 rounded-full hover:bg-secondary-foreground/20 p-0.5"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedContactIds((prev) => prev.filter((id) => id !== contact.id));
                  }}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
          {selectedCampaigns.map((campaign) => (
            <Badge key={`campaign-${campaign}`} variant="secondary" className="flex items-center gap-1 pr-1">
              {campaign}
              <button
                type="button"
                className="ml-1 rounded-full hover:bg-secondary-foreground/20 p-0.5"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelectedCampaigns((prev) => prev.filter((value) => value !== campaign));
                }}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

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
