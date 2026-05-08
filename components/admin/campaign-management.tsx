"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, MoreHorizontal, Plus, Target, Edit, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCampaigns, useCreateCampaign, useUpdateCampaign, useDeleteCampaign, Campaign } from "@/lib/query/useCampaigns";
import { useToast } from "@/hooks/use-toast";

export default function CampaignManagement() {
  const [search, setSearch] = useState("");
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<Campaign | null>(null);
  
  const { data: campaigns = [], isLoading, error } = useCampaigns();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    status: "active" as "active" | "inactive" | "completed",
  });

  const filteredCampaigns = campaigns.filter((campaign) =>
    campaign.name.toLowerCase().includes(search.toLowerCase()) ||
    campaign.description?.toLowerCase().includes(search.toLowerCase())
  );

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      status: "active",
    });
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Error",
        description: "Campaign name is required",
        variant: "destructive",
      });
      return;
    }
    try {
      await createCampaign.mutateAsync(formData);
      toast({
        title: "Success",
        description: "Campaign created successfully",
      });
      setIsCreateDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to create campaign",
        variant: "destructive",
      });
    }
  };

  const handleEdit = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Error",
        description: "Campaign name is required",
        variant: "destructive",
      });
      return;
    }
    if (!editingCampaign) {
      toast({
        title: "Error",
        description: "No campaign selected for editing",
        variant: "destructive",
      });
      return;
    }
    try {
      await updateCampaign.mutateAsync({
        id: editingCampaign.id,
        data: formData,
      });
      toast({
        title: "Success",
        description: "Campaign updated successfully",
      });
      setIsEditDialogOpen(false);
      setEditingCampaign(null);
      resetForm();
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update campaign",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: number, name: string) => {
    try {
      await deleteCampaign.mutateAsync(id);
      toast({
        title: "Success",
        description: `Campaign "${name}" deleted successfully`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: `Failed to delete campaign`,
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (campaign: Campaign) => {
    setEditingCampaign(campaign);
    setFormData({
      name: campaign.name,
      description: campaign.description || "",
      status: campaign.status,
    });
    setIsEditDialogOpen(true);
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "active":
        return "default";
      case "inactive":
        return "secondary";
      case "completed":
        return "outline";
      default:
        return "secondary";
    }
  };

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-500">Error loading campaigns: {error.message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Campaign Management</h1>
          <p className="text-muted-foreground">
            Manage your campaigns and their associated donations
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/admin/campaigns/merge">
              <Target className="h-4 w-4 mr-2" />
              Merge Campaigns
            </Link>
          </Button>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={resetForm}>
                <Plus className="h-4 w-4 mr-2" />
                New Campaign
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New Campaign</DialogTitle>
                <DialogDescription>
                  Add a new campaign to track donations and engagement.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name" className="mb-2">Campaign Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="Enter campaign name"
                  />
                </div>
                <div>
                  <Label htmlFor="description" className="mb-2">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Enter campaign description"
                    rows={3}
                  />
                </div>
                <div>
                  <Label htmlFor="status" className="mb-2">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value: "active" | "inactive" | "completed") =>
                      setFormData({ ...formData, status: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="inactive">Inactive</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={handleCreate} disabled={createCampaign.isPending}>
                  {createCampaign.isPending ? "Creating..." : "Create Campaign"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Campaigns ({campaigns.length})</CardTitle>
          <CardDescription>
            Manage campaign accounts, status, and details
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-2 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
              <Input
                placeholder="Search campaigns..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="text-center py-8">Loading campaigns...</div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="text-gray-400 mb-4">
                <Plus className="w-12 h-12" />
              </div>
              <h3 className="text-lg font-medium text-gray-900 mb-2">No campaigns yet</h3>
              <p className="text-gray-500 text-center mb-4">
                Create your first campaign to start tracking donations and engagement.
              </p>
              <Button onClick={() => setIsCreateDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Create Campaign
              </Button>
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No campaigns found matching your search.
            </div>
          ) : (
            <div className="rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[70px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredCampaigns.map((campaign) => (
                    <TableRow key={campaign.id}>
                      <TableCell className="font-medium">{campaign.name}</TableCell>
                      <TableCell className="max-w-xs truncate">
                        {campaign.description || "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusBadgeVariant(campaign.status)}>
                          {campaign.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {new Date(campaign.createdAt).toLocaleDateString()}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" className="h-8 w-8 p-0">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditDialog(campaign)}>
                              <Edit className="w-4 h-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <DropdownMenuItem
                                  onSelect={(e) => e.preventDefault()}
                                  className="text-red-600"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete &quot;{campaign.name}&quot;? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDelete(campaign.id, campaign.name)}
                                    className="bg-red-600 hover:bg-red-700"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Campaign</DialogTitle>
            <DialogDescription>
              Update the campaign details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="edit-name" className="mb-2">Campaign Name *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter campaign name"
              />
            </div>
            <div>
              <Label htmlFor="edit-description" className="mb-2">Description</Label>
              <Textarea
                id="edit-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter campaign description"
                rows={3}
              />
            </div>
            <div>
              <Label htmlFor="edit-status" className="mb-2">Status</Label>
              <Select
                value={formData.status}
                onValueChange={(value: "active" | "inactive" | "completed") =>
                  setFormData({ ...formData, status: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={updateCampaign.isPending}>
              {updateCampaign.isPending ? "Updating..." : "Update Campaign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}