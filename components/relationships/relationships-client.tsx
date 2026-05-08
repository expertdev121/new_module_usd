"use client";

import React, { useState } from "react";
import { useQueryState } from "nuqs";
import { z } from "zod";
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Search,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  useDeleteRelationship,
  useRelationships,
} from "@/lib/query/useRelationShips";

import { Dialog, DialogContent, DialogTitle } from "@radix-ui/react-dialog";
import { DialogHeader } from "../ui/dialog";
import RelationshipDialog from "../forms/relationships-form";

import { useContactDetailsQuery } from "@/lib/query/relationships/useRelationshipQuery"; // Adjust import to your path

interface RelationshipsTableProps {
  contactId: string | number;
}

const relationshipTypes = [
  "mother",
  "father",
  "grandmother",
  "grandfather",
  "sister",
  "spouse",
  "brother",
  "partner",
  "step-brother",
  "step-sister",
  "stepmother",
  "stepfather",
  "divorced co-parent",
  "separated co-parent",
  "legal guardian",
  "step-parent",
  "legal guardian partner",
  "grandparent",
  "aunt",
  "uncle",
  "aunt/uncle",
] as const;

const QueryParamsSchema = z.object({
  contactId: z.number().positive(),
  page: z.number().min(1).default(1),
  limit: z.number().min(1).max(100).default(10),
  search: z.string().optional(),
  sortBy: z.string().default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  relationshipType: z.enum(relationshipTypes).optional(),
  isActive: z.boolean().optional(),
  relatedContactId: z.number().positive().optional(),
});

type QueryParams = z.infer<typeof QueryParamsSchema>;
type RelationshipType = (typeof relationshipTypes)[number];

type Relationship = {
  id: number;
  contactId: number;
  relatedContactId: number;
  relationshipType: RelationshipType;
  isActive: boolean;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  relatedContactName?: string;
};

// Helper component: fetch and display contact full name by ID
function RelatedContactName({ contactId }: { contactId: number }) {
  const { data, isLoading, error } = useContactDetailsQuery(contactId);

  if (isLoading) return <span>Loading...</span>;
  if (error || !data?.contact)
    return <span>ID: {contactId}</span>;

  // Assuming API returns ‘contact’ object with firstName and lastName fields
  return (
    <span>
      {data.contact.displayName ||
        `${data.contact.firstName} ${data.contact.lastName}` ||
        "N/A"}
    </span>
  );
}

export default function RelationshipsTable({
  contactId,
}: RelationshipsTableProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [editRelationship, setEditRelationship] = useState<Relationship | null>(
    null
  );

  const { mutate: deleteRelationship, isPending: isDeleting } =
    useDeleteRelationship();

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
  const [relationshipType, setRelationshipType] =
    useQueryState<RelationshipType | null>("relationshipType", {
      parse: (value) =>
        relationshipTypes.includes(value as RelationshipType)
          ? (value as RelationshipType)
          : null,
      serialize: (value) => value ?? "",
      defaultValue: null,
    });
  const [isActive, setIsActive] = useQueryState<boolean | null>("isActive", {
    parse: (value) =>
      value === "true" ? true : value === "false" ? false : null,
    serialize: (value) => (value !== null ? value.toString() : ""),
    defaultValue: null,
  });
  const [relatedContactId, setRelatedContactId] = useQueryState(
    "relatedContactId",
    {
      parse: (value) => parseInt(value) || undefined,
      serialize: (value) => value?.toString() ?? "",
      defaultValue: undefined,
    }
  );

  const parsedContactId =
    typeof contactId === "string" ? parseInt(contactId) : contactId;

  let queryParams: QueryParams | null = null;
  let contactIdError: string | null = null;

  try {
    queryParams = QueryParamsSchema.parse({
      contactId: parsedContactId,
      page: page ?? 1,
      limit: limit ?? 10,
      search: search || undefined,
      sortBy: sortBy || undefined,
      sortOrder: sortOrder || undefined,
      relationshipType: relationshipType || undefined,
      isActive: isActive !== null ? isActive : undefined,
      relatedContactId: relatedContactId || undefined,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const contactIdIssue = error.issues.find((issue) =>
        issue.path.includes("contactId")
      );
      if (contactIdIssue) {
        contactIdError =
          "Invalid contact ID. Please provide a valid positive number.";
      }
    }
  }

  const fallbackParams: QueryParams = {
    contactId: 1, // fallback value
    page: 1,
    limit: 10,
    sortBy: "updatedAt",
    sortOrder: "desc",
  };

  const { data, isLoading, error } = useRelationships(
    queryParams || fallbackParams
  );

  const toggleRowExpansion = (relationshipId: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(relationshipId)) newExpanded.delete(relationshipId);
    else newExpanded.add(relationshipId);
    setExpandedRows(newExpanded);
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString();
  };

  const handleRelationshipTypeChange = (value: string) => {
    if (value === "all") {
      setRelationshipType(null);
    } else if (relationshipTypes.includes(value as RelationshipType)) {
      setRelationshipType(value as RelationshipType);
    }
  };

  const handleDeleteClick = (relationshipId: number) => {
    deleteRelationship(relationshipId, {
      onSuccess: () => {
        console.log("Relationship deleted successfully");
        // Optionally show a success message to the user
      },
      onError: (error) => {
        console.error("Failed to delete relationship:", error);
        // Optionally show an error message to the user
      },
    });
  };

  if (contactIdError) {
    return (
      <Alert className="mx-4 my-4" variant="destructive">
        <AlertDescription>{contactIdError}</AlertDescription>
      </Alert>
    );
  }

  if (error && queryParams) {
    return (
      <Alert className="mx-4 my-4" variant="destructive">
        <AlertDescription>
          Failed to load relationships data. Please try again later.
        </AlertDescription>
      </Alert>
    );
  }

  const shouldShowData = queryParams !== null;

  return (
    <div className="space-y-4 py-4">
      <Card>
        <CardHeader>
          <CardTitle>Relationships</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search relationships..."
                value={search || ""}
                onChange={(e) => setSearch(e.target.value || null)}
                className="pl-10"
              />
            </div>
            <Select
              value={relationshipType || "all"}
              onValueChange={handleRelationshipTypeChange}
            >
              <SelectTrigger className="w-full sm:w-36">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                {relationshipTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={isActive !== null ? isActive.toString() : "all"}
              onValueChange={(value) =>
                setIsActive(
                  value === "true" ? true : value === "false" ? false : null
                )
              }
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
            <Input
              placeholder="Related Contact ID"
              type="number"
              value={relatedContactId || ""}
              onChange={(e) =>
                setRelatedContactId(
                  e.target.value ? parseInt(e.target.value) : null
                )
              }
              className="w-full sm:w-36"
            />
            <RelationshipDialog contactId={contactId as number} />
          </div>

          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Relationship Type
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Related Contact
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Active
                  </TableHead>
                  <TableHead className="font-semibold text-gray-900">
                    Created At
                  </TableHead>
                  <TableHead className="w-12"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!shouldShowData ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-gray-500"
                    >
                      Invalid parameters
                    </TableCell>
                  </TableRow>
                ) : isLoading ? (
                  Array.from({ length: queryParams?.limit || 10 }).map(
                    (_, index) => (
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
                          <Skeleton className="h-4 w-16" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-20" />
                        </TableCell>
                        <TableCell>
                          <Skeleton className="h-4 w-4" />
                        </TableCell>
                      </TableRow>
                    )
                  )
                ) : data?.relationships.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-gray-500"
                    >
                      No relationships found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.relationships.map((relationship) => (
                    <React.Fragment key={relationship.id}>
                      <TableRow className="hover:bg-gray-50">
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleRowExpansion(relationship.id)}
                            className="p-1"
                          >
                            {expandedRows.has(relationship.id) ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">
                          {relationship.relationshipType} {/* or displayRelationshipType if you have */}
                        </TableCell>
                        <TableCell>
                          {/* Show related contact full name by fetching */}
                          <RelatedContactName contactId={relationship.relatedContactId} />
                        </TableCell>
                        <TableCell>
                          <span
                            className={`px-2 py-1 rounded-full text-xs ${relationship.isActive
                                ? "bg-green-100 text-green-800"
                                : "bg-red-100 text-red-800"
                              }`}
                          >
                            {relationship.isActive ? "Active" : "Inactive"}
                          </span>
                        </TableCell>
                        <TableCell>{formatDate(relationship.createdAt)}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="p-1"
                                disabled={isDeleting}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => handleDeleteClick(relationship.id)}
                                disabled={isDeleting}
                              >
                                {isDeleting ? "Deleting..." : "Delete Relationship"}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                      {expandedRows.has(relationship.id) && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-gray-50 p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div className="space-y-3">
                                <h4 className="font-semibold text-gray-900">
                                  Relationship Details
                                </h4>
                                <div className="space-y-2 text-sm">
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">Contact Name:</span>
                                    <span className="font-medium">
                                      {/* Fetch main contact name similarly or use passed data */}
                                      <RelatedContactName contactId={relationship.contactId} />
                                    </span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span className="text-gray-600">Updated At:</span>
                                    <span className="font-medium">
                                      {formatDate(relationship.updatedAt)}
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
                                    <span className="text-gray-600">Notes:</span>
                                    <p className="mt-1 text-gray-900">
                                      {relationship.notes || "No notes available"}
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
          {shouldShowData && data && data.relationships.length > 0 && (
            <div className="flex items-center justify-between mt-4">
              <div className="text-sm text-gray-600">
                Showing{" "}
                {((queryParams?.page ?? 1) - 1) * (queryParams?.limit ?? 10) + 1}{" "}
                to{" "}
                {Math.min(
                  (queryParams?.page ?? 1) * (queryParams?.limit ?? 10),
                  data.pagination.totalCount
                )}{" "}
                of {data.pagination.totalCount} relationships
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

      {/* Edit Relationship Dialog */}
      {editRelationship && (
        <Dialog
          open={!!editRelationship}
          onOpenChange={() => setEditRelationship(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Relationship</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <label className="text-right">Relationship Type</label>
                <Select
                  value={editRelationship.relationshipType}
                  onValueChange={(value) =>
                    setEditRelationship({
                      ...editRelationship,
                      relationshipType: value as RelationshipType,
                    })
                  }
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {relationshipTypes.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label className="text-right">Related Contact ID</label>
                <Input
                  type="number"
                  className="col-span-3"
                  value={editRelationship.relatedContactId}
                  onChange={(e) =>
                    setEditRelationship({
                      ...editRelationship,
                      relatedContactId: parseInt(e.target.value),
                    })
                  }
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label className="text-right">Active</label>
                <Select
                  value={editRelationship.isActive.toString()}
                  onValueChange={(value) =>
                    setEditRelationship({
                      ...editRelationship,
                      isActive: value === "true",
                    })
                  }
                >
                  <SelectTrigger className="col-span-3">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Active</SelectItem>
                    <SelectItem value="false">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <label className="text-right">Notes</label>
                <Input
                  className="col-span-3"
                  value={editRelationship.notes || ""}
                  onChange={(e) =>
                    setEditRelationship({
                      ...editRelationship,
                      notes: e.target.value || undefined,
                    })
                  }
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
