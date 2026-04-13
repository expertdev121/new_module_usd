"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Edit, Trash2, Search, Mail, Lock, User, MapPin } from "lucide-react";
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  ColumnDef,
} from "@tanstack/react-table";
import { DataTable } from "@/components/data-table/data-table";

interface AdminUser {
  id: number;
  email: string;
  role: string;
  status: string;
  accessType: "full" | "trial";
  locationId: string | null;
  orgName?: string | null;
  createdAt: string;
  trialEndsAt?: string | null;
  trialExpired?: boolean;
}

interface ApiResponse {
  data: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function ManageAdminsPage() {
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    role: "admin",
    status: "active",
    accessType: "full" as "full" | "trial",
    locationId: "",
  });
  const { toast } = useToast();

  // Server-side pagination state
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: 10,
  });

  // Store metadata from API
  const [pageCount, setPageCount] = useState(0);

  // Global filter state for search
  const [globalFilter, setGlobalFilter] = useState("");

  const columns: ColumnDef<AdminUser>[] = useMemo(() => [
    {
      accessorKey: "email",
      header: "Email",
      cell: ({ getValue }) => <span className="text-sm">{getValue() as string}</span>,
    },
    {
      accessorKey: "role",
      header: "Role",
      cell: ({ getValue }) => {
        const role = getValue() as string;
        return (
          <Badge variant={role === "super_admin" ? "destructive" : "default"}>
            {role}
          </Badge>
        );
      },
    },
    {
      accessorKey: "accessType",
      header: "Access",
      cell: ({ row }) => {
        const admin = row.original;
        return (
          <Badge variant={admin.accessType === "trial" ? "secondary" : "default"}>
            {admin.accessType === "trial" ? "On Trial" : "Full"}
          </Badge>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ getValue }) => {
        const status = getValue() as string;
        return (
          <Badge variant={status === "active" ? "default" : "secondary"}>
            {status}
          </Badge>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ getValue }) => {
        const date = getValue() as string;
        return <span className="text-sm">{new Date(date).toLocaleDateString()}</span>;
      },
    },
    {
      id: "trialExpiry",
      header: "Trial Ends",
      cell: ({ row }) => {
        const admin = row.original;

        if (admin.accessType !== "trial" || !admin.trialEndsAt) {
          return <span className="text-sm text-muted-foreground">Full access</span>;
        }

        return (
          <span className={`text-sm ${admin.trialExpired ? "text-red-600" : ""}`}>
            {new Date(admin.trialEndsAt).toLocaleDateString()}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const admin = row.original;
        return (
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEdit(admin)}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleDelete(admin.id)}
              disabled={admin.role === "super_admin"}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        );
      },
    },
  ], []);

  const table = useReactTable({
    data: admins,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualPagination: true, // Enable server-side pagination
    rowCount: pageCount * pagination.pageSize, // Total rows
    onPaginationChange: setPagination,
    onGlobalFilterChange: setGlobalFilter,
    state: {
      pagination,
      globalFilter,
    },
  });

  useEffect(() => {
    if (initialLoad) {
      fetchAdmins(0, 10);
      setInitialLoad(false);
    }
  }, [initialLoad]);

  // Fetch data when pagination changes
  useEffect(() => {
    if (!initialLoad) {
      fetchAdmins(pagination.pageIndex, pagination.pageSize);
    }
  }, [pagination.pageIndex, pagination.pageSize, initialLoad]);

  const fetchAdmins = async (pageIndex: number, pageSize: number) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/manage-admins?page=${pageIndex + 1}&pageSize=${pageSize}`);
      if (response.ok) {
        const result: ApiResponse = await response.json();
        setAdmins(result.data || []);
        setPageCount(result.totalPages);
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch admins",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to fetch admins",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (submitting) return; // Prevent multiple submissions

    setSubmitting(true);

    try {
      const url = editingAdmin
        ? `/api/admin/manage-admins/${editingAdmin.id}`
        : "/api/admin/manage-admins";

      const method = editingAdmin ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: `Admin ${editingAdmin ? "updated" : "created"} successfully`,
        });
        setDialogOpen(false);
        setEditingAdmin(null);
        setFormData({
          email: "",
          password: "",
          role: "admin",
          status: "active",
          accessType: "full",
          locationId: "",
        });
        fetchAdmins(pagination.pageIndex, pagination.pageSize);
      } else {
        const error = await response.json();
        toast({
          title: "Error",
          description: error.message || "Failed to save admin",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save admin",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (admin: AdminUser) => {
    setEditingAdmin(admin);
    setFormData({
      email: admin.email,
      password: "", // Don't populate password for security
      role: admin.role,
      status: admin.status,
      accessType: admin.accessType ?? "full",
      locationId: admin.locationId || "",
    });
    setDialogOpen(true);
  };

  const handleDelete = async (adminId: number) => {
    if (!confirm("Are you sure you want to delete this admin?")) return;

    try {
      const response = await fetch(`/api/admin/manage-admins/${adminId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast({
          title: "Success",
          description: "Admin deleted successfully",
        });
        fetchAdmins(pagination.pageIndex, pagination.pageSize);
      } else {
        toast({
          title: "Error",
          description: "Failed to delete admin",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete admin",
        variant: "destructive",
      });
    }
  };

  const openCreateDialog = () => {
    setEditingAdmin(null);
    setFormData({
      email: "",
      password: "",
      role: "admin",
      status: "active",
      accessType: "full",
      locationId: "",
    });
    setSubmitting(false);
    setDialogOpen(true);
  };

  return (
    <div className="container mx-auto p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold">Manage organization</h1>
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Add organization
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>organization Users</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2 mb-4">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={globalFilter ?? ""}
              onChange={(event) => setGlobalFilter(String(event.target.value))}
              className="max-w-sm"
            />
          </div>
          <DataTable table={table} />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-hidden sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingAdmin ? <Edit className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              {editingAdmin ? "Edit Organization User" : "Add Organization User"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex max-h-[calc(90vh-5rem)] flex-col">
            <div className="grid flex-1 gap-6 overflow-y-auto pr-2">
              {/* Account Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-foreground">Account Information</h3>
                <div className="grid gap-4">
                  <div className="relative">
                    <Label htmlFor="email" className="text-sm font-medium">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                        className="pl-10"
                        placeholder="Enter email address"
                        required
                      />
                    </div>
                  </div>
                  <div className="relative">
                    <Label htmlFor="password" className="text-sm font-medium">
                      Password {editingAdmin ? "(leave blank to keep current)" : ""}
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="password"
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="pl-10"
                        placeholder={editingAdmin ? "Leave blank to keep current" : "Enter password"}
                        required={!editingAdmin}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Permissions & Settings */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium text-foreground">Permissions & Settings</h3>
                <div className="grid gap-4">
                  {editingAdmin && (
                    <div className="relative">
                      <Label htmlFor="role" className="text-sm font-medium">Role</Label>
                      <div className="relative">
                        <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground z-10" />
                        <Select value={formData.role} onValueChange={(value) => setFormData({ ...formData, role: value })}>
                          <SelectTrigger className="pl-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="super_admin">Super Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                  <div className="relative">
                    <Label htmlFor="accessType" className="text-sm font-medium">Access Type</Label>
                    <Select
                      value={formData.accessType}
                      onValueChange={(value: "full" | "trial") =>
                        setFormData({ ...formData, accessType: value })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Full Access</SelectItem>
                        <SelectItem value="trial">On Trial</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-2">
                      Trial duration is calculated from the admin&apos;s creation date using
                      the `FREE_TRIAL_DAYS` env setting.
                    </p>
                  </div>
                  <div className="relative">
                    <Label htmlFor="status" className="text-sm font-medium">Status</Label>
                    <Select value={formData.status} onValueChange={(value) => setFormData({ ...formData, status: value })}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="suspended">Suspended</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="relative">
                    <Label htmlFor="locationId" className="text-sm font-medium">Location ID</Label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="locationId"
                        type="text"
                        value={formData.locationId}
                        onChange={(e) => setFormData({ ...formData, locationId: e.target.value })}
                        className="pl-10"
                        placeholder="Enter location ID (optional)"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-3 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button type="submit" className="min-w-[100px]" disabled={submitting}>
                {submitting ? "Submitting..." : editingAdmin ? "Update User" : "Create User"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
