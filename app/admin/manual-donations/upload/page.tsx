"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Papa from "papaparse";
import {
  Upload,
  FileSpreadsheet,
  Download,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

type CsvRow = Record<string, string>;

type UploadResponse = {
  message: string;
  createdCount: number;
  failedCount: number;
  created?: Array<{ rowNumber: number; donationId: number }>;
  errors?: Array<{ rowNumber: number; error: string }>;
};

type FieldDefinition = {
  key: string;
  label: string;
  required?: boolean;
  description: string;
};

const UNMAPPED = "__UNMAPPED__";

const fieldDefinitions: FieldDefinition[] = [
  { key: "ghlContactId", label: "GHL Contact ID", description: "Contact will be matched by GHL contact ID" },
  { key: "email", label: "Email", description: "Contact will be matched by email if GHL contact ID is not provided" },
  { key: "amount", label: "Amount", required: true, description: "Donation amount in the source currency" },
  { key: "receivedDate", label: "Received Date", required: true, description: "This will also be used as payment date" },
  { key: "accountName", label: "Account Name", description: "Matched by location and created if missing" },
  { key: "categoryName", label: "Category Name", description: "Matched by location and created if missing" },
  { key: "categoryItemName", label: "Category Item Name", description: "Matched inside the category and created if missing" },
  { key: "campaignName", label: "Campaign Name", description: "Matched by location and created if missing" },
  { key: "paymentMethod", label: "Payment Method", required: true, description: "Example: check, cash, credit" },
  { key: "paymentStatus", label: "Payment Status", description: "Defaults to completed if left unmapped" },
  { key: "referenceNumber", label: "Reference Number", description: "Optional reference number" },
  { key: "checkNumber", label: "Check Number", description: "Optional check number" },
  { key: "notes", label: "Notes", description: "Optional import notes" },
];

const templateHeaders = fieldDefinitions.map((field) => field.key);

const templateSampleRow = {
  ghlContactId: "abc123-contact",
  email: "donor@example.com",
  amount: "250",
  receivedDate: "2026-04-15",
  accountName: "Main Account",
  categoryName: "General",
  categoryItemName: "Website Donation",
  campaignName: "Spring Campaign",
  paymentMethod: "check",
  paymentStatus: "completed",
  referenceNumber: "CHK-1001",
  checkNumber: "1001",
  notes: "Imported from CSV",
};

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const buildInitialMapping = (headers: string[]) => {
  const mapping: Record<string, string> = {};

  for (const field of fieldDefinitions) {
    const matchedHeader = headers.find((header) => normalizeKey(header) === normalizeKey(field.key));
    mapping[field.key] = matchedHeader ?? UNMAPPED;
  }

  return mapping;
};

const mapRowsToUploadShape = (rows: CsvRow[], mapping: Record<string, string>) =>
  rows.map((row) => {
    const mappedRow: Record<string, string> = {};

    for (const field of fieldDefinitions) {
      const selectedHeader = mapping[field.key];
      if (selectedHeader && selectedHeader !== UNMAPPED) {
        mappedRow[field.key] = row[selectedHeader] ?? "";
      }
    }

    return mappedRow;
  });

export default function ManualDonationUploadPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [fileName, setFileName] = useState<string>("");
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [parseError, setParseError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
      return;
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      router.push("/contacts");
    }
  }, [router, session, status]);

  const presentHeaders = useMemo(() => {
    const allHeaders = new Set<string>();
    rows.forEach((row) => Object.keys(row).forEach((header) => allHeaders.add(header)));
    return [...allHeaders];
  }, [rows]);

  const requiredFieldsMissingMapping = useMemo(
    () =>
      fieldDefinitions
        .filter((field) => field.required && (!mapping[field.key] || mapping[field.key] === UNMAPPED))
        .map((field) => field.label),
    [mapping]
  );

  const hasContactLookupMapping = useMemo(
    () =>
      (mapping.ghlContactId && mapping.ghlContactId !== UNMAPPED) ||
      (mapping.email && mapping.email !== UNMAPPED),
    [mapping]
  );

  const duplicateMappings = useMemo(() => {
    const selectedHeaders = Object.values(mapping).filter((value) => value && value !== UNMAPPED);
    return [...new Set(selectedHeaders.filter((header, index) => selectedHeaders.indexOf(header) !== index))];
  }, [mapping]);

  const mappedRows = useMemo(() => mapRowsToUploadShape(rows, mapping), [rows, mapping]);
  const previewRows = mappedRows.slice(0, 10);

  const handleDownloadTemplate = () => {
    const csv = Papa.unparse([templateSampleRow], {
      columns: templateHeaders,
    });
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "manual-donation-upload-template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setUploadResult(null);

    if (!file) {
      setFileName("");
      setRows([]);
      setMapping({});
      setParseError(null);
      return;
    }

    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: { data: CsvRow[]; errors: Array<{ message: string }> }) => {
        if (results.errors.length > 0) {
          setParseError(results.errors[0]?.message || "Failed to parse CSV file");
          setRows([]);
          setMapping({});
          return;
        }

        const cleanedRows = results.data.map((row: CsvRow) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [key.trim(), typeof value === "string" ? value.trim() : value])
          )
        );

        const headers = [...new Set(cleanedRows.flatMap((row) => Object.keys(row)))];

        setParseError(null);
        setRows(cleanedRows);
        setMapping(buildInitialMapping(headers));
      },
      error: (error: Error) => {
        setParseError(error.message);
        setRows([]);
        setMapping({});
      },
    });
  };

  const handleMappingChange = (fieldKey: string, value: string) => {
    setMapping((current) => ({
      ...current,
      [fieldKey]: value,
    }));
  };

  const getAvailableHeadersForField = (fieldKey: string) => {
    const currentValue = mapping[fieldKey];
    const usedByOtherFields = new Set(
      Object.entries(mapping)
        .filter(([key, value]) => key !== fieldKey && value && value !== UNMAPPED)
        .map(([, value]) => value)
    );

    return presentHeaders.filter((header) => header === currentValue || !usedByOtherFields.has(header));
  };

  const resetAutoMapping = () => {
    setMapping(buildInitialMapping(presentHeaders));
    toast.success("Field mapping reset using automatic suggestions");
  };

  const handleUpload = async () => {
    if (rows.length === 0) {
      toast.error("Choose a CSV file with at least one row");
      return;
    }

    if (requiredFieldsMissingMapping.length > 0) {
      toast.error(`Map required fields first: ${requiredFieldsMissingMapping.join(", ")}`);
      return;
    }

    if (!hasContactLookupMapping) {
      toast.error("Map at least one contact lookup field: GHL Contact ID or Email");
      return;
    }

    if (duplicateMappings.length > 0) {
      toast.error(`A CSV column is mapped more than once: ${duplicateMappings.join(", ")}`);
      return;
    }

    setIsUploading(true);
    setUploadResult(null);

    try {
      const response = await fetch("/api/manual-donations/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rows: mappedRows }),
      });

      const result = (await response.json()) as UploadResponse;
      setUploadResult(result);

      if (!response.ok) {
        throw new Error(result.message || "Upload failed");
      }

      if (result.failedCount > 0) {
        toast.warning(result.message);
      } else {
        toast.success(result.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  if (status === "loading") {
    return <div className="py-8 text-center">Loading...</div>;
  }

  if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Manual Donation CSV Upload</h1>
          <p className="text-muted-foreground">
            Upload a CSV, map its columns to donation fields, preview the results, and then import.
          </p>
        </div>
        <Button variant="outline" onClick={handleDownloadTemplate}>
          <Download className="mr-2 h-4 w-4" />
          Download Template
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 1: Upload CSV</CardTitle>
          <CardDescription>
            You can upload files with any column names now. After upload, you’ll map only the small set of fields this import really needs.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input type="file" accept=".csv,text/csv" onChange={handleFileChange} />
          {fileName ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{fileName}</span>
              <Badge variant="secondary">{rows.length} rows</Badge>
              <Badge variant="outline">{presentHeaders.length} columns</Badge>
            </div>
          ) : null}

          {parseError ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{parseError}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {rows.length > 0 ? (
        <Card>
          <CardHeader>
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>Step 2: Map Fields</CardTitle>
                <CardDescription>
                  Match each manual donation field to a column from your CSV before importing.
                </CardDescription>
              </div>
              <Button variant="outline" onClick={resetAutoMapping}>
                <Wand2 className="mr-2 h-4 w-4" />
                Auto-map Again
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {requiredFieldsMissingMapping.length > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Required fields still need mapping: {requiredFieldsMissingMapping.join(", ")}
                </AlertDescription>
              </Alert>
            ) : !hasContactLookupMapping ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  Map at least one contact lookup field: GHL Contact ID or Email.
                </AlertDescription>
              </Alert>
            ) : (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>All required mappings are ready, including contact lookup.</AlertDescription>
              </Alert>
            )}

            {duplicateMappings.length > 0 ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  These CSV columns are used more than once: {duplicateMappings.join(", ")}
                </AlertDescription>
              </Alert>
            ) : null}

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Donation Field</TableHead>
                    <TableHead>CSV Column</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fieldDefinitions.map((field) => (
                    <TableRow key={field.key}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{field.label}</span>
                          {field.required ? <Badge variant="destructive">Required</Badge> : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          <code>{field.key}</code>
                        </div>
                      </TableCell>
                      <TableCell className="min-w-[240px]">
                        <Select
                          value={mapping[field.key] ?? UNMAPPED}
                          onValueChange={(value) => handleMappingChange(field.key, value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Choose CSV column" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNMAPPED}>Do not import</SelectItem>
                            {getAvailableHeadersForField(field.key).map((header) => (
                              <SelectItem key={`${field.key}-${header}`} value={header}>
                                {header}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{field.description}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                onClick={handleUpload}
                disabled={
                  isUploading ||
                  requiredFieldsMissingMapping.length > 0 ||
                  !hasContactLookupMapping ||
                  duplicateMappings.length > 0
                }
              >
                <Upload className="mr-2 h-4 w-4" />
                {isUploading ? "Importing..." : `Import ${rows.length} Rows`}
              </Button>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <ArrowRight className="h-4 w-4" />
                <span>We’ll import the mapped values shown in the preview below.</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Field Notes</CardTitle>
          <CardDescription>
            A few tips to keep imports clean and predictable.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border p-4">
            <div className="font-medium">Required fields</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Map <code>amount</code>, <code>receivedDate</code>, and <code>paymentMethod</code>, plus either <code>ghlContactId</code> or <code>email</code>.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">Defaults handled for you</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Currency is always <code>USD</code>, <code>amountUsd</code> matches amount, <code>exchangeRate</code> is <code>1</code>, and payment date comes from received date.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">Names instead of IDs</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Use <code>accountName</code>, <code>categoryName</code>, <code>categoryItemName</code>, and <code>campaignName</code>. We’ll match or create them for the current location.
            </p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="font-medium">Contact matching</div>
            <p className="mt-1 text-sm text-muted-foreground">
              Each row must provide either a GHL contact ID or an email so we can find the donor.
            </p>
          </div>
        </CardContent>
      </Card>

      {previewRows.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Step 3: Preview Mapped Data</CardTitle>
            <CardDescription>Showing the first {previewRows.length} mapped rows that will be sent to import.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    {fieldDefinitions
                      .filter((field) => mapping[field.key] && mapping[field.key] !== UNMAPPED)
                      .slice(0, 8)
                      .map((field) => (
                        <TableHead key={field.key}>{field.label}</TableHead>
                      ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((row, index) => (
                    <TableRow key={`mapped-${index}`}>
                      <TableCell>{index + 2}</TableCell>
                      {fieldDefinitions
                        .filter((field) => mapping[field.key] && mapping[field.key] !== UNMAPPED)
                        .slice(0, 8)
                        .map((field) => (
                          <TableCell key={field.key}>{row[field.key] || "-"}</TableCell>
                        ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {uploadResult ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Import Result
            </CardTitle>
            <CardDescription>{uploadResult.message}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
                Created: {uploadResult.createdCount}
              </Badge>
              <Badge variant={uploadResult.failedCount > 0 ? "destructive" : "secondary"}>
                Failed: {uploadResult.failedCount}
              </Badge>
            </div>

            {uploadResult.errors && uploadResult.errors.length > 0 ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>CSV Row</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {uploadResult.errors.map((error) => (
                      <TableRow key={`${error.rowNumber}-${error.error}`}>
                        <TableCell>{error.rowNumber}</TableCell>
                        <TableCell>{error.error}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
