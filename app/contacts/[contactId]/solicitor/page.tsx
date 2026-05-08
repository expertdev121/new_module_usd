"use client";

import { useParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { format } from "date-fns";
import { CalendarIcon, Trash2, Edit, Save, X, UserPlus } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useQueryState } from "nuqs";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
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
import { Skeleton } from "@/components/ui/skeleton";
import SolicitorDashboard from "@/components/solicitor-dashboard";

const solicitorSchema = z.object({
  solicitorCode: z.string().optional(),
  status: z.enum(["active", "inactive", "suspended"]),
  commissionRate: z.coerce.number().min(0).max(100).optional(),
  hireDate: z.string().optional(),
  terminationDate: z.string().optional(),
  notes: z.string().optional(),
});

type SolicitorFormData = z.infer<typeof solicitorSchema>;

interface SolicitorData {
  id: number;
  contactId: number;
  solicitorCode: string | null;
  status: "active" | "inactive" | "suspended";
  commissionRate: string | null;
  hireDate: string | null;
  terminationDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

interface SolicitorResponse {
  solicitor: SolicitorData;
}

interface CreateSolicitorResponse {
  message: string;
  solicitor: SolicitorData;
}

const statusColors = {
  active: "bg-green-100 text-green-800",
  inactive: "bg-gray-100 text-gray-800",
  suspended: "bg-red-100 text-red-800",
};

const fetchSolicitor = async (
  contactId: string
): Promise<SolicitorResponse> => {
  const response = await fetch(`/api/contacts/${contactId}/solicitor`);

  if (response.status === 404) {
    throw new Error("NOT_FOUND");
  }

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to fetch solicitor data");
  }

  return response.json();
};

const createSolicitor = async ({
  contactId,
  data,
}: {
  contactId: string;
  data: SolicitorFormData;
}): Promise<CreateSolicitorResponse> => {
  const response = await fetch(`/api/contacts/${contactId}/solicitor`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to create solicitor");
  }

  return response.json();
};

const updateSolicitor = async ({
  contactId,
  data,
}: {
  contactId: string;
  data: SolicitorFormData;
}): Promise<CreateSolicitorResponse> => {
  const response = await fetch(`/api/contacts/${contactId}/solicitor`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to update solicitor");
  }

  return response.json();
};

const deleteSolicitor = async (
  contactId: string
): Promise<{ message: string }> => {
  const response = await fetch(`/api/contacts/${contactId}/solicitor`, {
    method: "DELETE",
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || "Failed to delete solicitor");
  }

  return response.json();
};

export default function SolicitorPage() {
  const params = useParams();
  const contactId = params.contactId as string;
  const queryClient = useQueryClient();

  // URL state management
  const [mode, setMode] = useQueryState("mode", {
    defaultValue: "view",
    clearOnDefault: true,
  });

  const [error, setError] = useQueryState("error", {
    defaultValue: "",
    clearOnDefault: true,
  });

  const isEditing = mode === "edit";
  const isCreating = mode === "create";
  const isViewing = mode === "view";

  // TanStack Query for fetching solicitor data
  const {
    data: solicitorResponse,
    isLoading,
    error: queryError,
    isError,
  } = useQuery({
    queryKey: ["solicitor", contactId],
    queryFn: () => fetchSolicitor(contactId),
    retry: (failureCount, error) => {
      // Don't retry on 404 (contact not a solicitor)
      if (error.message === "NOT_FOUND") return false;
      return failureCount < 3;
    },
  });

  const solicitor = solicitorResponse?.solicitor;
  const isSolicitor = !!solicitor;

  // React Hook Form setup
  const form = useForm<SolicitorFormData>({
    resolver: zodResolver(solicitorSchema),
    defaultValues: {
      status: "active",
      solicitorCode: "",
      commissionRate: undefined,
      hireDate: "",
      terminationDate: "",
      notes: "",
    },
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: createSolicitor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["solicitor", contactId] });
      setMode("view");
      setError("");
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  const updateMutation = useMutation({
    mutationFn: updateSolicitor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["solicitor", contactId] });
      setMode("view");
      setError("");
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSolicitor,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["solicitor", contactId] });
      setMode("view");
      setError("");
    },
    onError: (error: Error) => {
      setError(error.message);
    },
  });

  // Update form when solicitor data changes
  useEffect(() => {
    if (solicitor && (isViewing || isEditing)) {
      form.reset({
        solicitorCode: solicitor.solicitorCode || "",
        status: solicitor.status,
        commissionRate: solicitor.commissionRate
          ? parseFloat(solicitor.commissionRate)
          : undefined,
        hireDate: solicitor.hireDate || "",
        terminationDate: solicitor.terminationDate || "",
        notes: solicitor.notes || "",
      });
    }
  }, [solicitor, form, isViewing, isEditing]);

  // Handle mode changes
  const handleEdit = () => {
    setMode("edit");
    setError("");
  };

  const handleCreate = () => {
    setMode("create");
    setError("");
    form.reset({
      status: "active",
      solicitorCode: "",
      commissionRate: undefined,
      hireDate: "",
      terminationDate: "",
      notes: "",
    });
  };

  const handleCancel = () => {
    setMode("view");
    setError("");

    if (solicitor) {
      // Reset form to current solicitor data
      form.reset({
        solicitorCode: solicitor.solicitorCode || "",
        status: solicitor.status,
        commissionRate: solicitor.commissionRate
          ? parseFloat(solicitor.commissionRate)
          : undefined,
        hireDate: solicitor.hireDate || "",
        terminationDate: solicitor.terminationDate || "",
        notes: solicitor.notes || "",
      });
    }
  };

  // Form submission
  const onSubmit = (data: SolicitorFormData) => {
    if (isCreating) {
      createMutation.mutate({ contactId, data });
    } else if (isEditing) {
      updateMutation.mutate({ contactId, data });
    }
  };

  const handleDelete = () => {
    deleteMutation.mutate(contactId);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="container mx-auto py-6 space-y-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const displayError =
    error ||
    (isError && queryError.message !== "NOT_FOUND" ? queryError.message : "");

  return (
    <div className="container mx-auto py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Solicitor Management</h1>
          <p className="text-muted-foreground">
            {solicitor
              ? `Manage solicitor settings for ${solicitor.firstName} ${solicitor.lastName}`
              : "Convert this contact to a solicitor"}
          </p>
        </div>

        {!isSolicitor && !isCreating && (
          <Button onClick={handleCreate} className="gap-2">
            <UserPlus className="h-4 w-4" />
            Make Solicitor
          </Button>
        )}
      </div>

      {/* Error Alert */}
      {displayError && (
        <Alert variant="destructive">
          <AlertDescription>{displayError}</AlertDescription>
        </Alert>
      )}
      {!isSolicitor && !isCreating && !isError && (
        <Card>
          <CardHeader>
            <CardTitle>Not a Solicitor</CardTitle>
            <CardDescription>
              This contact is not currently set up as a solicitor. Click
              &quot;Make Solicitor&quot; to convert them.
            </CardDescription>
          </CardHeader>
        </Card>
      )}
      {(isSolicitor || isCreating) && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>
                  {isCreating
                    ? "Create New Solicitor"
                    : "Solicitor Information"}
                </CardTitle>
                <CardDescription>
                  {isCreating
                    ? "Set up this contact as a solicitor"
                    : "View and manage solicitor details"}
                </CardDescription>
              </div>

              {isSolicitor && isViewing && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={handleEdit}
                    className="gap-2"
                  >
                    <Edit className="h-4 w-4" />
                    Edit
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="destructive" className="gap-2">
                        <Trash2 className="h-4 w-4" />
                        Remove
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Remove Solicitor Status
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to remove solicitor status from
                          this contact? This will also delete all associated
                          bonus rules and calculations.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={handleDelete}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          disabled={deleteMutation.isPending}
                        >
                          {deleteMutation.isPending ? "Removing..." : "Remove"}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}
            </div>
          </CardHeader>

          <CardContent>
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Solicitor Code */}
                  <FormField
                    control={form.control}
                    name="solicitorCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Solicitor Code</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            placeholder="Optional unique identifier"
                            disabled={isViewing}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Status */}
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Status</FormLabel>
                        <FormControl>
                          {isViewing ? (
                            <div className="flex items-center h-10">
                              <Badge className={statusColors[field.value]}>
                                {field.value?.charAt(0).toUpperCase() +
                                  field.value?.slice(1)}
                              </Badge>
                            </div>
                          ) : (
                            <Select
                              value={field.value}
                              onValueChange={field.onChange}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="inactive">
                                  Inactive
                                </SelectItem>
                                <SelectItem value="suspended">
                                  Suspended
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Commission Rate */}
                  <FormField
                    control={form.control}
                    name="commissionRate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Commission Rate (%)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            min="0"
                            max="100"
                            step="0.01"
                            placeholder="0.00"
                            disabled={isViewing}
                            value={field.value || ""}
                            onChange={(e) =>
                              field.onChange(
                                e.target.value
                                  ? parseFloat(e.target.value)
                                  : undefined
                              )
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  
                </div>

                {/* Notes */}
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          {...field}
                          placeholder="Additional notes about this solicitor"
                          disabled={isViewing}
                          rows={3}
                          value={field.value || ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* Action Buttons */}
                {(isEditing || isCreating) && (
                  <>
                    <Separator />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleCancel}
                        disabled={
                          createMutation.isPending || updateMutation.isPending
                        }
                        className="gap-2"
                      >
                        <X className="h-4 w-4" />
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          createMutation.isPending || updateMutation.isPending
                        }
                        className="gap-2"
                      >
                        <Save className="h-4 w-4" />
                        {createMutation.isPending || updateMutation.isPending
                          ? "Saving..."
                          : isCreating
                          ? "Create Solicitor"
                          : "Save Changes"}
                      </Button>
                    </div>
                  </>
                )}
              </form>
            </Form>
          </CardContent>
        </Card>
      )}
      {solicitor && isViewing && (
        <Card>
          <CardHeader>
            <CardTitle>Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <Label className="font-medium">Created</Label>
                <p className="text-muted-foreground">
                  {format(new Date(solicitor.createdAt), "PPP")}
                </p>
              </div>
              <div>
                <Label className="font-medium">Last Updated</Label>
                <p className="text-muted-foreground">
                  {format(new Date(solicitor.updatedAt), "PPP")}
                </p>
              </div>
              <div>
                <Label className="font-medium">Contact Email</Label>
                <p className="text-muted-foreground">
                  {solicitor.email || "Not provided"}
                </p>
              </div>
              <div>
                <Label className="font-medium">Contact Phone</Label>
                <p className="text-muted-foreground">
                  {solicitor.phone || "Not provided"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      <SolicitorDashboard />
    </div>
  );
}
