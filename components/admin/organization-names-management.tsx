"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Building2, Edit, Plus, Search, Trash2 } from "lucide-react";

interface OrganizationNameRecord {
  id: number;
  locationId: string;
  orgName: string;
  createdAt: string;
  updatedAt: string;
}

interface OrganizationNameResponse {
  data: OrganizationNameRecord[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export function OrganizationNamesManagement() {
  const [orgDialogOpen, setOrgDialogOpen] = useState(false);
  const [editingOrganizationName, setEditingOrganizationName] =
    useState<OrganizationNameRecord | null>(null);
  const [orgSubmitting, setOrgSubmitting] = useState(false);
  const [organizationNames, setOrganizationNames] = useState<OrganizationNameRecord[]>([]);
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: 10,
    totalCount: 0,
    totalPages: 1,
  });
  const [orgFormData, setOrgFormData] = useState({
    locationId: "",
    orgName: "",
  });
  const { toast } = useToast();

  useEffect(() => {
    void fetchOrganizationNames(1, search);
  }, [search]);

  const fetchOrganizationNames = async (page = pagination.page, searchValue = search) => {
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pagination.pageSize),
      });

      if (searchValue.trim()) {
        params.set("search", searchValue.trim());
      }

      const response = await fetch(`/api/admin/organization-names?${params.toString()}`);
      if (!response.ok) {
        throw new Error("Failed to fetch organization names");
      }

      const result: OrganizationNameResponse = await response.json();
      setOrganizationNames(result.data || []);
      setPagination(result.pagination);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch organization names",
        variant: "destructive",
      });
    }
  };

  const handleOrganizationNameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (orgSubmitting) return;

    setOrgSubmitting(true);

    try {
      const isEditing = Boolean(editingOrganizationName);
      const url = isEditing
        ? `/api/admin/organization-names/${editingOrganizationName?.locationId}`
        : "/api/admin/organization-names";
      const method = isEditing ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(orgFormData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to save organization name");
      }

      toast({
        title: "Success",
        description: `Organization name ${isEditing ? "updated" : "saved"} successfully`,
      });
      setOrgDialogOpen(false);
      setEditingOrganizationName(null);
      setOrgFormData({ locationId: "", orgName: "" });
      fetchOrganizationNames(1, search);
    } catch (error) {
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to save organization name",
        variant: "destructive",
      });
    } finally {
      setOrgSubmitting(false);
    }
  };

  const handleOrganizationNameEdit = (record: OrganizationNameRecord) => {
    setEditingOrganizationName(record);
    setOrgFormData({
      locationId: record.locationId,
      orgName: record.orgName,
    });
    setOrgDialogOpen(true);
  };

  const handleOrganizationNameDelete = async (locationId: string) => {
    if (!confirm("Are you sure you want to delete this organization name?")) return;

    try {
      const response = await fetch(`/api/admin/organization-names/${locationId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("Failed to delete organization name");
      }

      toast({
        title: "Success",
        description: "Organization name deleted successfully",
      });
      fetchOrganizationNames(
        organizationNames.length === 1 && pagination.page > 1
          ? pagination.page - 1
          : pagination.page,
        search
      );
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete organization name",
        variant: "destructive",
      });
    }
  };

  const openOrganizationNameDialog = () => {
    setEditingOrganizationName(null);
    setOrgFormData({
      locationId: "",
      orgName: "",
    });
    setOrgSubmitting(false);
    setOrgDialogOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Organization Names</CardTitle>
          <Button onClick={openOrganizationNameDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Add Org Name
          </Button>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex items-center space-x-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search organization names or location IDs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
          </div>
          <div className="space-y-3">
            {organizationNames.length === 0 ? (
              <p className="text-sm text-muted-foreground">No organization names added yet.</p>
            ) : (
              organizationNames.map((record) => (
                <div
                  key={record.locationId}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <div className="font-medium">{record.orgName}</div>
                    <div className="text-sm text-muted-foreground">{record.locationId}</div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOrganizationNameEdit(record)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleOrganizationNameDelete(record.locationId)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
          <div className="mt-6 flex items-center justify-between border-t pt-4">
            <div className="text-sm text-muted-foreground">
              {pagination.totalCount === 0
                ? "No results"
                : `Showing ${(pagination.page - 1) * pagination.pageSize + 1} to ${Math.min(
                    pagination.page * pagination.pageSize,
                    pagination.totalCount
                  )} of ${pagination.totalCount}`}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchOrganizationNames(pagination.page - 1, search)}
                disabled={pagination.page <= 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fetchOrganizationNames(pagination.page + 1, search)}
                disabled={pagination.page >= pagination.totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={orgDialogOpen} onOpenChange={setOrgDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {editingOrganizationName ? "Edit Org Name" : "Add Org Name"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleOrganizationNameSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="org-locationId">Location ID</Label>
              <Input
                id="org-locationId"
                value={orgFormData.locationId}
                onChange={(e) =>
                  setOrgFormData({ ...orgFormData, locationId: e.target.value })
                }
                disabled={Boolean(editingOrganizationName)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-name">Org Name</Label>
              <Input
                id="org-name"
                value={orgFormData.orgName}
                onChange={(e) =>
                  setOrgFormData({ ...orgFormData, orgName: e.target.value })
                }
                required
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOrgDialogOpen(false)}
                disabled={orgSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={orgSubmitting}>
                {orgSubmitting
                  ? "Saving..."
                  : editingOrganizationName
                    ? "Update Org Name"
                    : "Save Org Name"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
