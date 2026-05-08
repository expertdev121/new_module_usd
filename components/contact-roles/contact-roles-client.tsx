/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useState } from "react";
import { useQueryState } from "nuqs";
import { z } from "zod";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { useContactRoles } from "@/lib/query/useContactRoles";
import ContactRoleDialog from "../forms/contact-role-form";

interface ContactRolesTableProps {
  contactId: string | number;
}

const QueryParamsSchema = z.object({
  contactId: z.number().positive(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z.string().default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  roleName: z.string().optional(),
  isActive: z.boolean().optional(),
});

export default function ContactRolesTable({
  contactId,
}: ContactRolesTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
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
  const [isActive, setIsActive] = useQueryState<boolean | null>("isActive", {
    parse: (value) =>
      value === "true" ? true : value === "false" ? false : null,
    serialize: (value) => (value !== null ? value.toString() : ""),
    defaultValue: null,
  });

  const parsedContactId =
    typeof contactId === "string" ? parseInt(contactId) : contactId;

  const currentPage = page ?? 1;
  const currentLimit = limit ?? 10;

  const validContactId =
    isNaN(parsedContactId) || parsedContactId <= 0 ? 1 : parsedContactId;

  const queryParams = QueryParamsSchema.parse({
    contactId: validContactId,
    page: currentPage,
    limit: currentLimit,
    search: search || undefined,
    sortBy: sortBy || undefined,
    sortOrder: sortOrder || undefined,
    roleName: undefined,
    isActive: isActive !== null ? isActive : undefined,
  });

  const { data, isLoading, error } = useContactRoles(queryParams);

  if (isNaN(parsedContactId) || parsedContactId <= 0) {
    return (
      <Alert className="mx-4 my-4" variant="destructive">
        <AlertDescription>
          Invalid contact ID. Please provide a valid positive number.
        </AlertDescription>
      </Alert>
    );
  }

  const toggleRowExpansion = (roleId: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(roleId)) {
      newExpanded.delete(roleId);
    } else {
      newExpanded.add(roleId);
    }
    setExpandedRows(newExpanded);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  if (error) {
    return (
      <Alert className="mx-4 my-4" variant="destructive">
        <AlertDescription>
          Failed to load contact roles data. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4 py-4">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle>Contact Roles</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search roles..."
                value={search || ""}
                onChange={(e) => setSearch(e.target.value || null)}
                className="pl-10"
              />
            </div>

            {/* Is Active Filter */}
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
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">Active</SelectItem>
                <SelectItem value="false">Inactive</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <ContactRoleDialog contactId={contactId as any} />
          </div>

          {/* Table */}
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Role Name
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Start Date
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    End Date
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Status
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Created At
                  </TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: currentLimit }).map((_, index) => (
                    <TableRow key={index}>
                      <TableCell>
                        <Skeleton className="h-4 w-4" />
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
                      <TableCell>
                        <Skeleton className="h-4 w-20" />
                      </TableCell>
                      <TableCell>
                        <Skeleton className="h-4 w-4" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data?.contactRoles.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="text-center py-8 text-gray-500"
                    >
                      No contact roles found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.contactRoles.map((role) => (
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
                        <TableCell className="font-medium">
                          {role.roleName}
                        </TableCell>
                        <TableCell>{formatDate(role.startDate)}</TableCell>
                        <TableCell>{formatDate(role.endDate)}</TableCell>
                        <TableCell>
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
                        {/* <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="p-1">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem>Edit Role</DropdownMenuItem>
                              <DropdownMenuItem className="text-red-600">
                                Delete Role
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell> */}
                      </TableRow>

                      {expandedRows.has(role.id) && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-gray-50 p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-3">
                                <h4 className="font-semibold text-gray-900">
                                  Role Details
                                </h4>
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">
                                      Contact ID:
                                    </span>
                                    <span className="font-medium">
                                      {role.contactId}
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">
                                      Updated At:
                                    </span>
                                    <span className="font-medium">
                                      {formatDate(role.updatedAt)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="space-y-3">
                                <h4 className="font-semibold text-gray-900">
                                  Additional Details
                                </h4>
                                <div className="space-y-2 text-sm">
                                  <div>
                                    <span className="text-gray-600">
                                      Notes:
                                    </span>
                                    <p className="mt-1 text-gray-900">
                                      {role.notes || "No notes available"}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            </div>
                            {/* <div className="mt-4 pt-4 flex gap-2 border-t">
                              <Button className="flex items-center gap-2">
                                <Plus className="h-4 w-4" />
                                Update Role
                              </Button>
                            </div> */}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {data && data.contactRoles.length > 0 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-gray-600">
                Showing {(currentPage - 1) * currentLimit + 1} to{" "}
                {Math.min(
                  currentPage * currentLimit,
                  data.pagination.totalCount
                )}{" "}
                of {data.pagination.totalCount} roles
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(currentPage - 1)}
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
                  onClick={() => setPage(currentPage + 1)}
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
