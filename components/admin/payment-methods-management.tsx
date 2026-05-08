"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Edit2, Trash2, Power, PowerOff, ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";

// Types based on your schema
interface PaymentMethodDetail {
  id: number;
  paymentMethodId: number;
  key: string;
  value: string;
  createdAt?: string;
  updatedAt?: string;
}

interface PaymentMethod {
  id: number;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt?: string;
  updatedAt?: string;
  details: PaymentMethodDetail[];
}

// API Response types to handle schema variations
interface PaymentMethodApiResponse {
  id: number;
  name: string;
  description?: string;
  isActive?: boolean;
  is_active?: boolean;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}

interface PaymentMethodDetailApiResponse {
  id: number;
  paymentMethodId?: number;
  payment_method_id?: number;
  key: string;
  value: string;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
}


type PaymentMethodsManagementProps = {
  allMethods: PaymentMethod[];
  search?: string;
  onSearchChange?: (value: string) => void;
  onRefresh?: () => void;
};

function PaymentMethodsManagement({
  allMethods,
  search: externalSearch = "",
  onSearchChange,
  onRefresh
}: PaymentMethodsManagementProps) {
  const [activeTab, setActiveTab] = useState<"methods" | "details">("methods");
  const [search, setSearch] = useState(externalSearch);
  const [detailSearch, setDetailSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  // Local pagination state for methods tab
  const [currentPageMethods, setCurrentPageMethods] = useState(1);
  const [pageSizeMethods, setPageSizeMethods] = useState(10);

  // Local pagination state for details tab
  const [currentPageDetails, setCurrentPageDetails] = useState(1);
  const [pageSizeDetails, setPageSizeDetails] = useState(10);

  // Form states
  const [addForm, setAddForm] = useState({ name: "", description: "" });
  const [editForm, setEditForm] = useState<{ 
    id: number; 
    name: string; 
    description?: string; 
    isActive: boolean 
  }>({ 
    id: 0, 
    name: "", 
    description: "", 
    isActive: true 
  });
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [detailForm, setDetailForm] = useState<{ key: string; value: string }>({ 
    key: "", 
    value: "" 
  });
  const [detailMethodId, setDetailMethodId] = useState<number | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [detailEditMode, setDetailEditMode] = useState(false);

  // Loading states
  const [addLoading, setAddLoading] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);



  // Update search when external search changes
  useEffect(() => {
    setSearch(externalSearch);
    // Reset pages when search changes
    setCurrentPageMethods(1);
    setCurrentPageDetails(1);
  }, [externalSearch]);

  // Handle search change
  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (onSearchChange) {
      onSearchChange(value);
    }
    // Reset pages when search changes
    setCurrentPageMethods(1);
    setCurrentPageDetails(1);
  };

  // Handle detail search change (local search for details)
  const handleDetailSearchChange = (value: string) => {
    setDetailSearch(value);
    setCurrentPageDetails(1);
  };

  // Filter methods by search
  const filteredMethods = search
    ? allMethods.filter(m =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        (m.description || "").toLowerCase().includes(search.toLowerCase())
      )
    : allMethods;

  // Pagination for methods
  const totalMethods = filteredMethods.length;
  const totalPagesMethods = Math.ceil(totalMethods / pageSizeMethods);
  const startIndexMethods = (currentPageMethods - 1) * pageSizeMethods;
  const endIndexMethods = startIndexMethods + pageSizeMethods;
  const paginatedMethods = filteredMethods.slice(startIndexMethods, endIndexMethods);

  // Get all details from all methods for the details tab, filtered by search on method name/description
  const searchedMethods = search
    ? allMethods.filter(m =>
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        (m.description || "").toLowerCase().includes(search.toLowerCase())
      )
    : allMethods;

  const allDetails = searchedMethods.flatMap(method =>
    method.details.map(detail => ({
      ...detail,
      methodName: method.name,
      methodDescription: method.description,
      methodIsActive: method.isActive,
      method: method // Add full method object for toggle functionality
    }))
  );

  // Filter details for the details view
  const filteredDetails = detailSearch
    ? allDetails.filter((detail) =>
        detail.key.toLowerCase().includes(detailSearch.toLowerCase()) ||
        detail.value.toLowerCase().includes(detailSearch.toLowerCase()) ||
        detail.methodName.toLowerCase().includes(detailSearch.toLowerCase())
      )
    : allDetails;

  // Pagination for details
  const totalDetails = filteredDetails.length;
  const totalPagesDetails = Math.ceil(totalDetails / pageSizeDetails);
  const startIndexDetails = (currentPageDetails - 1) * pageSizeDetails;
  const endIndexDetails = startIndexDetails + pageSizeDetails;
  const paginatedDetails = filteredDetails.slice(startIndexDetails, endIndexDetails);

  // Normalize API response to match our interface
  const normalizePaymentMethod = (apiMethod: PaymentMethodApiResponse): Omit<PaymentMethod, 'details'> => ({
    id: apiMethod.id,
    name: apiMethod.name,
    description: apiMethod.description,
    isActive: apiMethod.isActive !== undefined ? apiMethod.isActive : apiMethod.is_active !== undefined ? apiMethod.is_active : true,
    createdAt: apiMethod.createdAt || apiMethod.created_at,
    updatedAt: apiMethod.updatedAt || apiMethod.updated_at,
  });

  const normalizePaymentMethodDetail = (apiDetail: PaymentMethodDetailApiResponse): PaymentMethodDetail => ({
    id: apiDetail.id,
    paymentMethodId: apiDetail.paymentMethodId || apiDetail.payment_method_id || 0,
    key: apiDetail.key,
    value: apiDetail.value,
    createdAt: apiDetail.createdAt || apiDetail.created_at,
    updatedAt: apiDetail.updatedAt || apiDetail.updated_at,
  });



  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddLoading(true);
    try {
      const res = await fetch("/api/admin/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(addForm),
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to add");
      setAddDialogOpen(false);
      setAddForm({ name: "", description: "" });
      onRefresh?.();
      toast.success("Payment method added successfully");
    } catch {
      toast.error("Failed to add payment method");
    }
    setAddLoading(false);
  }

  function openEditDialog(method: PaymentMethod) {
    setEditForm({ 
      id: method.id, 
      name: method.name, 
      description: method.description, 
      isActive: method.isActive 
    });
    setEditDialogOpen(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    setEditLoading(true);
    try {
      const { isActive, ...rest } = editForm;
      const payload = {
        ...rest,
        isActive: isActive,
      };
      const res = await fetch("/api/admin/payment-methods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to update");
      setEditDialogOpen(false);
      onRefresh?.();
      toast.success("Payment method updated successfully");
    } catch {
      toast.error("Failed to update payment method");
    }
    setEditLoading(false);
  }

  function openDeleteDialog(id: number) {
    setDeleteId(id);
    setDeleteDialogOpen(true);
  }

  async function handleDelete() {
    if (!deleteId) return;
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/admin/payment-methods", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteId }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error("Failed to delete");
      setDeleteDialogOpen(false);
      setDeleteId(null);
      onRefresh?.();
      toast.success("Payment method deleted successfully");
    } catch {
      toast.error("Failed to delete payment method");
    }
    setDeleteLoading(false);
  }

  async function handleToggleActive(method: PaymentMethod) {
    try {
      await fetch("/api/admin/payment-methods", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...method, isActive: !method.isActive }),
        credentials: 'include',
      });
      onRefresh?.();
      toast.success(`Payment method ${method.isActive ? 'deactivated' : 'activated'} successfully`);
    } catch {
      toast.error("Failed to update status");
    }
  }

  function openAddDetailDialog(method: PaymentMethod) {
    setDetailEditMode(false);
    setDetailForm({ key: "", value: "" });
    setDetailMethodId(method.id);
    setDetailId(null);
    setDetailDialogOpen(true);
  }

  function openEditDetailDialog(detail: PaymentMethodDetail & { methodName: string; method: PaymentMethod }) {
    setDetailEditMode(true);
    setDetailForm({ key: detail.key, value: detail.value });
    setDetailMethodId(detail.paymentMethodId);
    setDetailId(detail.id);
    setDetailDialogOpen(true);
  }

  async function handleDetailFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!detailMethodId) return;
    try {
      if (detailEditMode && detailId) {
        const res = await fetch('/api/admin/payment-methods/details', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            id: detailId, 
            key: detailForm.key, 
            value: detailForm.value 
          }),
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to update detail');
        toast.success('Detail updated successfully');
      } else {
        const res = await fetch('/api/admin/payment-methods/details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            paymentMethodId: detailMethodId, 
            key: detailForm.key, 
            value: detailForm.value 
          }),
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to add detail');
        toast.success('Detail added successfully');
      }
      setDetailDialogOpen(false);
      setDetailId(null);
      setDetailMethodId(null);
      setDetailForm({ key: '', value: '' });
      onRefresh?.();
    } catch {
      toast.error('Failed to save detail');
    }
  }

  async function handleDeleteDetail(detail: PaymentMethodDetail & { methodName: string }) {
    if (!window.confirm('Delete this detail?')) return;
    try {
      const res = await fetch('/api/admin/payment-methods/details', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: detail.id }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete detail');
      toast.success('Detail deleted successfully');
      onRefresh?.();
    } catch {
      toast.error('Failed to delete detail');
    }
  }

  const getStatusBadge = (isActive: boolean) => {
    return isActive ? (
      <Badge variant="default">Active</Badge>
    ) : (
      <Badge variant="secondary">Inactive</Badge>
    );
  };

  if (loading) {
    return <div className="text-center py-8">Loading payment methods...</div>;
  }

  return (
    <>
      <Tabs value={activeTab} className="w-full" onValueChange={(v) => setActiveTab(v as "methods" | "details")}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="methods">Payment Methods</TabsTrigger>
          <TabsTrigger value="details">Method Details</TabsTrigger>
        </TabsList>

        <TabsContent value="methods" className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button onClick={() => setAddDialogOpen(true)} className="bg-green-600 hover:bg-green-700">
              <Plus className="h-4 w-4 mr-2" />
              Add Payment Method
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedMethods.map((method) => (
                <TableRow key={method.id}>
                  <TableCell className="font-medium">{method.name}</TableCell>
                  <TableCell className="text-muted-foreground">{method.description || "-"}</TableCell>
                  <TableCell>{getStatusBadge(method.isActive)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {method.createdAt ? new Date(method.createdAt).toLocaleDateString() : '-'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEditDialog(method)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleToggleActive(method)}
                        title={method.isActive ? "Deactivate" : "Activate"}
                      >
                        {method.isActive ? (
                          <PowerOff className="h-4 w-4" />
                        ) : (
                          <Power className="h-4 w-4" />
                        )}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openDeleteDialog(method.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {totalPagesMethods > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {((currentPageMethods - 1) * pageSizeMethods) + 1} to {Math.min(currentPageMethods * pageSizeMethods, totalMethods)} of {totalMethods} payment methods
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPageMethods(currentPageMethods - 1)}
                  disabled={currentPageMethods === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPageMethods} of {totalPagesMethods}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPageMethods(currentPageMethods + 1)}
                  disabled={currentPageMethods === totalPagesMethods}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="details" className="space-y-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search details..."
                value={detailSearch}
                onChange={(e) => handleDetailSearchChange(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              onClick={() => {
                // Open add detail dialog with first method selected
                if (allMethods.length > 0) {
                  openAddDetailDialog(allMethods[0]);
                }
              }}
              className="bg-green-600 hover:bg-green-700"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Detail
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Payment Method</TableHead>
                <TableHead>Method Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedDetails.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No details found.
                  </TableCell>
                </TableRow>
              ) : (
                paginatedDetails.map((detail) => (
                  <TableRow key={detail.id}>
                    <TableCell className="font-medium">{detail.key}</TableCell>
                    <TableCell>{detail.value}</TableCell>
                    <TableCell>{detail.methodName}</TableCell>
                    <TableCell>{getStatusBadge(detail.methodIsActive)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEditDetailDialog(detail)}>
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(detail.method)}
                          title={detail.methodIsActive ? "Deactivate Method" : "Activate Method"}
                        >
                          {detail.methodIsActive ? (
                            <PowerOff className="h-4 w-4" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => handleDeleteDetail(detail)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {totalPagesDetails > 1 && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {((currentPageDetails - 1) * pageSizeDetails) + 1} to {Math.min(currentPageDetails * pageSizeDetails, totalDetails)} of {totalDetails} details
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPageDetails(currentPageDetails - 1)}
                  disabled={currentPageDetails === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {currentPageDetails} of {totalPagesDetails}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPageDetails(currentPageDetails + 1)}
                  disabled={currentPageDetails === totalPagesDetails}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Add Payment Method Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Payment Method</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <Input
                required
                placeholder="Payment method name"
                value={addForm.name}
                onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <Input
                placeholder="Description (optional)"
                value={addForm.description}
                onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setAddDialogOpen(false)} disabled={addLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={addLoading}>
                {addLoading ? "Adding..." : "Add"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Payment Method Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Payment Method</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <Input
                required
                placeholder="Payment method name"
                value={editForm.name}
                onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Description</label>
              <Input
                placeholder="Description (optional)"
                value={editForm.description || ""}
                onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                id="is_active"
                checked={editForm.isActive}
                onChange={(e) => setEditForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="h-4 w-4"
              />
              <label htmlFor="is_active" className="text-sm font-medium">Active</label>
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} disabled={editLoading}>
                Cancel
              </Button>
              <Button type="submit" disabled={editLoading}>
                {editLoading ? "Updating..." : "Update"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Payment Method Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Payment Method</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p>Are you sure you want to delete this payment method? This action cannot be undone.</p>
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setDeleteDialogOpen(false)} disabled={deleteLoading}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDelete} disabled={deleteLoading}>
              {deleteLoading ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{detailEditMode ? "Edit" : "Add"} Method Detail</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleDetailFormSubmit} className="space-y-4">
            {!detailEditMode && (
              <div>
                <label className="block text-sm font-medium mb-1">Payment Method</label>
                <select
                  className="w-full px-3 py-2 border rounded-md"
                  value={detailMethodId || ""}
                  onChange={(e) => setDetailMethodId(Number(e.target.value))}
                  required
                >
                  <option value="">Select Payment Method</option>
                  {allMethods.map((method) => (
                    <option key={method.id} value={method.id}>
                      {method.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">Key</label>
              <Input
                required
                placeholder="Detail key"
                value={detailForm.key}
                onChange={e => setDetailForm(f => ({ ...f, key: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Value</label>
              <Input
                required
                placeholder="Detail value"
                value={detailForm.value}
                onChange={e => setDetailForm(f => ({ ...f, value: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setDetailDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">{detailEditMode ? "Update" : "Add"}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default PaymentMethodsManagement;
