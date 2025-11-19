/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  FileSpreadsheet,
  FileText,
  Loader2,
  AlertCircle,
  Download,
} from "lucide-react";
import * as XLSX from "xlsx";
import {
  getContacts,
  getPayments,
  getPaymentsWithDetails,
  getPledges,
  getPledgesWithDetails,
  getSolicitors,
  getCategories,
  getContactsWithData,
} from "@/app/contacts/[contactId]/exports/queries";

const dataTypes = [
  { value: "contacts", label: "Contacts", query: getContacts },
  { value: "payments", label: "Payments", query: getPayments },
  {
    value: "payments_detailed",
    label: "Payments (Detailed)",
    query: getPaymentsWithDetails,
  },
  { value: "pledges", label: "Pledges", query: getPledges },
  {
    value: "pledges_detailed",
    label: "Pledges (Detailed)",
    query: getPledgesWithDetails,
  },
  { value: "solicitors", label: "Solicitors", query: getSolicitors },
  { value: "categories", label: "Categories", query: getCategories },
  {
    value: "contacts_with_data",
    label: "Contacts with Data",
    query: getContactsWithData,
  },
];

interface ExportDataDialogProps {
  triggerText?: string;
  triggerVariant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link";
  autoExport?: {
    dataType: string;
    format: "csv" | "xlsx";
  };
}

export default function ExportDataDialog({
  triggerText = "Export Data",
  triggerVariant = "outline",
  autoExport,
}: ExportDataDialogProps) {
  const { data: session } = useSession();
  const [selectedDataType, setSelectedDataType] = useState("contacts");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const currentDataType = dataTypes.find((dt) => dt.value === selectedDataType);

  const { data, isLoading, error } = useQuery({
    queryKey: [selectedDataType, session?.user?.locationId],
    queryFn: () => currentDataType?.query(session?.user?.locationId) || Promise.resolve([]),
    enabled: !!currentDataType && open,
  });

  const formatDataForExport = (data: any[]) => {
    if (!data || !data.length) return [];

    return data.map((item) => {
      const formatted: any = {};
      Object.keys(item).forEach((key) => {
        const header = key
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (str) => str.toUpperCase());
        let value = item[key];
        if (value instanceof Date) {
          value = value.toISOString().split("T")[0];
        } else if (
          typeof value === "string" &&
          value.includes("T") &&
          value.includes("Z")
        ) {
          try {
            value = new Date(value).toISOString().split("T")[0];
          } catch (error) {
            // If date parsing fails, keep the original value
            value = item[key];
          }
        }
        formatted[header] = value;
      });
      return formatted;
    });
  };

  const exportToXLSX = async (overrideData?: any[]) => {
    const dataToExport = overrideData || data;
    if (!dataToExport || !dataToExport.length) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const formattedData = formatDataForExport(dataToExport);
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(formattedData);
      const colWidths = Object.keys(formattedData[0] || {}).map((key) => ({
        wch: Math.max(key.length, 15),
      }));
      ws["!cols"] = colWidths;
      XLSX.utils.book_append_sheet(
        wb,
        ws,
        selectedDataType.replace("_", " ").toUpperCase()
      );
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `${selectedDataType}_export_${timestamp}.xlsx`;
      XLSX.writeFile(wb, filename);

      // Close dialog after successful export
      setTimeout(() => setOpen(false), 1000);
    } catch (error) {
      console.error("Export to XLSX failed:", error);
      setExportError("Failed to export to XLSX.");
    } finally {
      setIsExporting(false);
    }
  };

  const exportToCSV = async (overrideData?: any[]) => {
    const dataToExport = overrideData || data;
    if (!dataToExport || !dataToExport.length) return;
    setIsExporting(true);
    setExportError(null);
    try {
      const formattedData = formatDataForExport(dataToExport);
      const headers = Object.keys(formattedData[0]);
      const csvContent = [
        headers.join(","),
        ...formattedData.map((row) =>
          headers
            .map((header) => {
              const value = row[header];
              if (
                typeof value === "string" &&
                (value.includes(",") || value.includes('"'))
              ) {
                return `"${value.replace(/"/g, '""')}"`;
              }
              return value ?? "";
            })
            .join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().split("T")[0];
      const filename = `${selectedDataType}_export_${timestamp}.csv`;
      link.href = URL.createObjectURL(blob);
      link.download = filename;
      link.click();
      URL.revokeObjectURL(link.href);

      // Close dialog after successful export
      setTimeout(() => setOpen(false), 1000);
    } catch (error) {
      console.error("Export to CSV failed:", error);
      setExportError("Failed to export to CSV.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      // Reset state when dialog closes
      setExportError(null);
      setIsExporting(false);
    }
  };

  useEffect(() => {
    if (autoExport && !open) {
      const dataType = dataTypes.find(dt => dt.value === autoExport.dataType);
      if (dataType) {
        setSelectedDataType(autoExport.dataType);
        // Fetch data and export automatically
        dataType.query(session?.user?.locationId).then((fetchedData) => {
          if (autoExport.format === 'csv') {
            exportToCSV(fetchedData);
          } else {
            exportToXLSX(fetchedData);
          }
        }).catch((error) => {
          console.error("Auto export failed:", error);
          setExportError("Failed to auto export data.");
        });
      }
    }
  }, [autoExport, open, session?.user?.locationId]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} className="gap-2">
          <Download className="h-4 w-4" />
          {triggerText}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Data</DialogTitle>
          <DialogDescription>
            Select the data type you want to export and choose your preferred
            format.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {(error || exportError) && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {error ? "Failed to load data from database." : exportError}
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Data Type</label>
              <Select
                value={selectedDataType}
                onValueChange={setSelectedDataType}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dataTypes.map((dataType) => (
                    <SelectItem key={dataType.value} value={dataType.value}>
                      {dataType.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Records available:
              </span>
              {isLoading ? (
                <Badge variant="secondary">
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Loading...
                </Badge>
              ) : (
                <Badge variant="outline">{data?.length || 0} records</Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Button
              onClick={() => exportToXLSX()}
              disabled={isExporting || !data?.length || isLoading}
              className="w-full"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4 mr-2" />
              )}
              Export as XLSX
            </Button>

            <Button
              onClick={() => exportToCSV()}
              disabled={isExporting || !data?.length || isLoading}
              variant="outline"
              className="w-full"
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileText className="h-4 w-4 mr-2" />
              )}
              Export as CSV
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
