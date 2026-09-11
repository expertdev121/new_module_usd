"use client";

import { useState } from "react";
import { useDeleteTagMutation } from "@/lib/query/tags/useTagsQuery";
import { TagDialog } from "./tag-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, Search, Download } from "lucide-react";
import { Tag } from "@/lib/db/schema";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";

interface TagsResponse {
  tags: Tag[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  filters: {
    search?: string;
    isActive?: boolean;
    showOnPayment?: boolean;
    showOnPledge?: boolean;
    sortBy: string;
    sortOrder: string;
  };
}

function useTagsQuery({
  search,
  limit = 50,
  page = 1,
  isActive,
}: {
  search?: string;
  limit?: number;
  page?: number;
  isActive?: boolean;
}) {
  return useQuery<TagsResponse>({
    queryKey: ["tags", search, limit, page, isActive],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.append("search", search);
      params.append("limit", limit.toString());
      params.append("page", page.toString());
      if (isActive !== undefined) params.append("isActive", isActive.toString());

      const res = await fetch(`/api/tags?${params.toString()}`);
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to fetch tags");
      }
      return res.json() as Promise<TagsResponse>;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });
}

export { useTagsQuery };

interface TagsManagementProps {
  contactId?: number;
  // Add additional props if needed for contact-specific filtering
  showContactSpecific?: boolean;
}

export function TagsManagement({ contactId, showContactSpecific = false }: TagsManagementProps) {
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTag, setEditingTag] = useState<Tag | undefined>();
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tagToDelete, setTagToDelete] = useState<Tag | undefined>();
  const [page, setPage] = useState(1);
  const [showActiveOnly, setShowActiveOnly] = useState(true);

  const { data: tagsResponse, isLoading, error, refetch } = useTagsQuery({
    search,
    limit: 50,
    page,
    isActive: showActiveOnly ? true : undefined,
  });

  const deleteTagMutation = useDeleteTagMutation({
    onSuccess: () => {
      toast.success("Tag deleted successfully");
      setDeleteDialogOpen(false);
      setTagToDelete(undefined);
      refetch(); // Refetch the tags list
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete tag");
    },
  });

  const handleCreateTag = () => {
    setEditingTag(undefined);
    setDialogOpen(true);
  };

  const handleEditTag = (tag: Tag) => {
    setEditingTag(tag);
    setDialogOpen(true);
  };

  const handleDeleteTag = (tag: Tag) => {
    setTagToDelete(tag);
    setDeleteDialogOpen(true);
  };

  // Download a CSV of every contact carrying this tag (name, address, email,
  // phone) — for mailings / appeals. Triggers a file download without
  // navigating away from the page.
  const handleExportTag = (tag: Tag) => {
    toast.success(`Preparing "${tag.name}" contact export…`);
    const link = document.createElement("a");
    link.href = `/api/contacts/export?tagId=${tag.id}`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const confirmDelete = async () => {
    if (!tagToDelete) return;
    await deleteTagMutation.mutateAsync({ tagId: tagToDelete.id });
  };

  const handleDialogClose = (open: boolean) => {
    setDialogOpen(open);
    if (!open) {
      // Dialog is closing, refetch tags in case changes were made
      refetch();
    }
  };

  const tags = tagsResponse?.tags || [];
  const pagination = tagsResponse?.pagination;

  if (error) {
    return (
      <div className="space-y-4">
        <div className="text-center py-8">
          <p className="text-red-600 mb-4">Failed to load tags</p>
          <Button onClick={() => refetch()} variant="outline">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Tags Management</h2>
          {showContactSpecific && (
            <p className="text-sm text-muted-foreground">
              Managing tags for Contact ID: {contactId}
            </p>
          )}
        </div>
        <Button onClick={handleCreateTag}>
          <Plus className="mr-2 h-4 w-4" />
          Create Tag
        </Button>
      </div>

      <div className="flex items-center space-x-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tags..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex items-center space-x-2">
          <label className="text-sm font-medium">Show active only:</label>
          <input
            type="checkbox"
            checked={showActiveOnly}
            onChange={(e) => setShowActiveOnly(e.target.checked)}
            className="h-4 w-4"
          />
        </div>
      </div>

      {pagination && pagination.totalCount > 0 && (
        <div className="text-sm text-muted-foreground">
          Showing {tags.length} of {pagination.totalCount} tags
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              {/* <TableHead>Description</TableHead> */}
              <TableHead>Visibility</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <div className="flex items-center justify-center space-x-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-900"></div>
                    <span>Loading tags...</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : tags.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <div className="space-y-2">
                    <p className="text-muted-foreground">
                      {search ? "No tags found matching your search" : "No tags found"}
                    </p>
                    {search && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        onClick={() => setSearch("")}
                      >
                        Clear search
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              tags.map((tag) => (
                <TableRow key={tag.id}>
                  <TableCell className="font-medium">{tag.name}</TableCell>
                  {/* <TableCell className="max-w-xs truncate">
                    {tag.description || "-"}
                  </TableCell> */}
                  <TableCell>
                    <div className="flex gap-1 flex-wrap">
                      {tag.showOnPayment && (
                        <Badge variant="secondary" className="text-xs">
                          Payments
                        </Badge>
                      )}
                      {tag.showOnPledge && (
                        <Badge variant="secondary" className="text-xs">
                          Pledges
                        </Badge>
                      )}
                      {!tag.showOnPayment && !tag.showOnPledge && (
                        <span className="text-xs text-muted-foreground">None</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={tag.isActive ? "default" : "secondary"}>
                      {tag.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExportTag(tag)}
                        title="Export contacts with this tag (CSV)"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditTag(tag)}
                        title="Edit tag"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDeleteTag(tag)}
                        title="Delete tag"
                        disabled={deleteTagMutation.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
          </div>
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={!pagination.hasPreviousPage}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={!pagination.hasNextPage}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <TagDialog
        open={dialogOpen}
        onOpenChange={handleDialogClose}
        tag={editingTag}
        mode={editingTag ? "edit" : "create"}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tag</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the tag &quot;{tagToDelete?.name}&quot;?
              This action cannot be undone and will remove the tag from all associated
              records.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteTagMutation.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction 
              onClick={confirmDelete}
              disabled={deleteTagMutation.isPending}
              className="bg-red-600 hover:bg-red-700"
            >
              {deleteTagMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}