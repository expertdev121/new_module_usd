"use client";

import React, { useState, useEffect } from "react";
import { useQueryState } from "nuqs";
import { z } from "zod";
import {
  useStudentRoles,
  useDeactivateStudentRole,
} from "@/lib/query/useStudentRoles";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Alert, AlertDescription } from "../ui/alert";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { Button } from "../ui/button";
import StudentRoleDialog from "../forms/student-role";
import { formatDate } from "@/lib/utils";

interface StudentRolesTableProps {
  contactId: string | number;
}

const QueryParamsSchema = z.object({
  contactId: z.number().positive(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z.string().default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  program: z.enum(["LH", "LLC", "ML", "Kollel", "Madrich"]).optional(),
  status: z
    .enum([
      "Student",
      "Active Soldier",
      "Staff",
      "Withdrew",
      "Transferred Out",
      "Left Early",
      "Asked to Leave",
    ])
    .optional(),
  year: z.string().optional(),
  isActive: z.boolean().optional(),
});

type QueryParams = z.infer<typeof QueryParamsSchema>;

export default function StudentRolesTable({ contactId }: StudentRolesTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // ALL HOOKS AT THE TOP - Query state management
  const [page, setPage] = useQueryState("page", {
    parse: (value) => parseInt(value) || 1,
    serialize: (value) => value.toString(),
    defaultValue: 1,
  });
  const [limit] = useQueryState("limit", {
    parse: (value) => parseInt(value) || 10,
    serialize: (value) => value.toString(),
    defaultValue: 10,
  });
  const [search, setSearch] = useQueryState("search", {
    defaultValue: "",
    parse: (value) => value || "",
    serialize: (value) => value,
  });
  const [sortBy] = useQueryState("sortBy", {
    defaultValue: "updatedAt",
    parse: (value) => value || "updatedAt",
    serialize: (value) => value,
  });
  const [sortOrder] = useQueryState<"asc" | "desc">("sortOrder", {
    defaultValue: "desc",
    parse: (value) => (value === "asc" || value === "desc" ? value : "desc"),
    serialize: (value) => value,
  });
  const [program, setProgram] = useQueryState<
    "LH" | "LLC" | "ML" | "Kollel" | "Madrich" | null
  >("program", {
    parse: (value) =>
      ["LH", "LLC", "ML", "Kollel", "Madrich"].includes(value)
        ? (value as "LH" | "LLC" | "ML" | "Kollel" | "Madrich")
        : null,
    serialize: (value) => value ?? "",
    defaultValue: null,
  });
  const [status, setStatus] = useQueryState<
    | "Student"
    | "Active Soldier"
    | "Staff"
    | "Withdrew"
    | "Transferred Out"
    | "Left Early"
    | "Asked to Leave"
    | null
  >("status", {
    parse: (value) =>
      [
        "Student",
        "Active Soldier",
        "Staff",
        "Withdrew",
        "Transferred Out",
        "Left Early",
        "Asked to Leave",
      ].includes(value)
        ? (value as
            | "Student"
            | "Active Soldier"
            | "Staff"
            | "Withdrew"
            | "Transferred Out"
            | "Left Early"
            | "Asked to Leave")
        : null,
    serialize: (value) => value ?? "",
    defaultValue: null,
  });
  const [year, setYear] = useQueryState("year", {
    defaultValue: "",
    parse: (value) => value || "",
    serialize: (value) => value,
  });
  const [isActive, setIsActive] = useQueryState<boolean | null>("isActive", {
    parse: (value) =>
      value === "true" ? true : value === "false" ? false : null,
    serialize: (value) => (value !== null ? value.toString() : ""),
    defaultValue: null,
  });

  const parsedContactId =
    typeof contactId === "string" ? parseInt(contactId) : contactId;

  // Create valid query params with fallback for invalid contactId
  const validContactId =
    isNaN(parsedContactId) || parsedContactId <= 0 ? 1 : parsedContactId;

  let queryParams: QueryParams;

  try {
    queryParams = QueryParamsSchema.parse({
      contactId: validContactId,
      page: page ?? 1,
      limit: limit ?? 10,
      search: search || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
      program: program || undefined,
      status: status || undefined,
      year: year || undefined,
      isActive: isActive !== null ? isActive : undefined,
    });
  } catch (error) {
    console.log(error);
    // Fallback params if parsing fails
    queryParams = {
      contactId: 1,
      page: 1,
      limit: 10,
      sortBy: "updatedAt",
      sortOrder: "desc" as const,
    };
  }

  // Hook called unconditionally
  const { data, isLoading, error } = useStudentRoles(queryParams);
  const {
    mutate: deactivateRole,
    isPending: isDeactivating,
    error: deactivateError,
  } = useDeactivateStudentRole();

  // Handle deactivation error - MOVED BEFORE EARLY RETURNS
  useEffect(() => {
    if (deactivateError) {
      setErrorMessage(
        deactivateError.response?.data?.error || "Failed to deactivate student role"
      );
    }
  }, [deactivateError]);

  // Check for contactId error AFTER hooks
  if (isNaN(parsedContactId) || parsedContactId <= 0) {
    return (
      <Alert className="mx-4 my-4" variant="destructive">
        <AlertDescription>
          Invalid contact ID. Please provide a valid positive number.
        </AlertDescription>
      </Alert>
    );
  }

  const handleDeactivate = (roleId: number) => {
    setErrorMessage(null); // Clear previous errors
    deactivateRole(roleId, {
      onSuccess: () => {
        console.log(`Student role ${roleId} deactivated successfully`);
      },
      onError: () => {
        setErrorMessage("Failed to deactivate student role");
      },
    });
  };

  const toggleRowExpansion = (roleId: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(roleId)) newExpanded.delete(roleId);
    else newExpanded.add(roleId);
    setExpandedRows(newExpanded);
  };

  if (error) {
    return (
      <Alert className="mx-4 my-4" variant="destructive">
        <AlertDescription>
          Failed to load student roles data. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4 py-4">
      {errorMessage && (
        <Alert className="mx-4 my-4" variant="destructive">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Enrollment</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search roles..."
                value={search || ""}
                onChange={(e) => setSearch(e.target.value || null)}
                className="pl-10"
              />
            </div>
            <Select
              value={program || "all"}
              onValueChange={(value) =>
                setProgram(
                  value === "all" ? null : (value as "LH" | "LLC" | "ML" | "Kollel" | "Madrich")
                )
              }
            >
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue placeholder="Program" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LH">LH</SelectItem>
                <SelectItem value="LLC">LLC</SelectItem>
                <SelectItem value="ML">ML</SelectItem>
                <SelectItem value="Kollel">Kollel</SelectItem>
                <SelectItem value="Madrich">Madrich</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={status || "all"}
              onValueChange={(value) =>
                setStatus(
                  value === "all"
                    ? null
                    : (value as
                        | "Student"
                        | "Active Soldier"
                        | "Staff"
                        | "Withdrew"
                        | "Transferred Out"
                        | "Left Early"
                        | "Asked to Leave")
                )
              }
            >
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Student">Student</SelectItem>
                <SelectItem value="Active Soldier">Active Soldier</SelectItem>
                <SelectItem value="Staff">Staff</SelectItem>
                <SelectItem value="Withdrew">Withdrew</SelectItem>
                <SelectItem value="Transferred Out">Transferred Out</SelectItem>
                <SelectItem value="Left Early">Left Early</SelectItem>
                <SelectItem value="Asked to Leave">Asked to Leave</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Input
              placeholder="Year"
              value={year || ""}
              onChange={(e) => setYear(e.target.value || null)}
              className="w-full sm:w-24"
            />
            <Select
              value={isActive !== null ? isActive.toString() : "all"}
              onValueChange={(value) => {
                if (value === "true") {
                  setIsActive(true);
                } else if (value === "false") {
                  setIsActive(false);
                } else {
                  setIsActive(null);
                }
              }}
            >
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue placeholder="Active Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <StudentRoleDialog contactId={contactId as number} />
          </div>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead className="font-semibold text-gray-900">Year</TableHead>
                  <TableHead className="font-semibold text-gray-900">Program</TableHead>
                  <TableHead className="font-semibold text-gray-900">Track</TableHead>
                  <TableHead className="font-semibold text-gray-900">Track Detail</TableHead>
                  <TableHead className="font-semibold text-gray-900">Status</TableHead>
                  <TableHead className="font-semibold text-gray-900">Machzor</TableHead>
                  {/* <TableHead className="font-semibold text-gray-900">Active</TableHead>
                  <TableHead className="font-semibold text-gray-900">Created At</TableHead> */}
                  {/* <TableHead className="w-12">Actions</TableHead> */}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: queryParams?.limit || 10 }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Skeleton className="h-4 w-4" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-24" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-16" />
                      </TableCell>
                      {/* <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-4" />
                      </TableCell> */}
                    </TableRow>
                  ))
                ) : data?.studentRoles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-gray-500">
                      No student roles found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.studentRoles.map((role) => (
                    <React.Fragment key={role.id}>
                      <TableRow className="hover:bg-gray-50">
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleRowExpansion(role.id)}
                            className="p-1"
                          >
                            {expandedRows.has(role.id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell>{role.year}</TableCell> {/* Year */}
                        <TableCell className="font-medium">{role.program}</TableCell> {/* Program */}
                        <TableCell>{role.track || "N/A"}</TableCell> {/* Track */}

                        {/* Track Detail - using additionalNotes as example */}
                        <TableCell>{role.trackDetail || "N/A"}</TableCell>

                        <TableCell>{role.status}</TableCell> {/* Status */}
                        <TableCell>{role.machzor || "N/A"}</TableCell> {/* Machzor */}

                        {/* <TableCell>
                          <span
                            className={`px-2 py-1 rounded-full text-xs ${
                              role.isActive
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                            }`}
                          >
                            {role.isActive ? "Active" : "Inactive"}
                          </span>
                        </TableCell>

                        <TableCell>{formatDate(role.createdAt)}</TableCell>

                        <TableCell>
                          {role.isActive && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeactivate(role.id)}
                              disabled={isDeactivating}
                            >
                              {isDeactivating ? "Deactivating..." : "Deactivate"}
                            </Button>
                          )}
                        </TableCell> */}
                      </TableRow>
                      {expandedRows.has(role.id) && (
                        <TableRow>
                          <TableCell colSpan={10} className="bg-gray-50 p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-3">
                                <h4 className="font-semibold text-gray-900">Role Details</h4>
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">Contact ID:</span>
                                    <span className="font-medium">{role.contactId}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">Machzor:</span>
                                    <span className="font-medium">{role.machzor || "N/A"}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">Start Date:</span>
                                    <span className="font-medium">
                                      {formatDate(role.startDate || "")}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">End Date:</span>
                                    <span className="font-medium">
                                      {formatDate(role.endDate || "")}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">Updated At:</span>
                                    <span className="font-medium">{formatDate(role.updatedAt)}</span>
                                  </div>
                                </div>
                              </div>
                              <div className="space-y-3">
                                <h4 className="font-semibold text-gray-900">Additional Details</h4>
                                <div className="space-y-2 text-sm">
                                  <div>
                                    <span className="text-gray-600">Notes:</span>
                                    <p className="mt-1 text-gray-900">
                                      {role.additionalNotes || "No notes available"}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {data && data.studentRoles.length > 0 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-gray-600">
                Showing{" "}
                {((queryParams?.page ?? 1) - 1) * (queryParams?.limit ?? 10) + 1}{" "}
                to{" "}
                {Math.min(
                  (queryParams?.page ?? 1) * (queryParams?.limit ?? 10),
                  data.pagination.totalCount
                )}{" "}
                of {data.pagination.totalCount} roles
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((queryParams?.page ?? 1) - 1)}
                  disabled={!data.pagination.hasPreviousPage}
                >
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  <span className="text-sm text-gray-600">
                    Page {data.pagination.page} of {data.pagination.totalPages}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((queryParams?.page ?? 1) + 1)}
                  disabled={!data.pagination.hasNextPage}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
