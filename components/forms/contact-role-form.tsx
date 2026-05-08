/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { UserPlus } from "lucide-react";
import {
  useContactDetailsQuery,
  useCreateContactRoleMutation,
} from "@/lib/query/contact-roles/useContactRole";

const commonRoles = [
  "Solicitor",
  "Volunteer",
  "Donor",
  "Committee Member",
] as const;

const contactRoleSchema = z
  .object({
    contactId: z.coerce.number().positive("Contact ID is required"),
    roleName: z.string().min(1, "Role name is required"),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    isActive: z.boolean().default(true),
    notes: z.string().optional(),
  })
  .refine(
    (data) => {
      if (data.startDate && data.endDate) {
        return new Date(data.startDate) <= new Date(data.endDate);
      }
      return true;
    },
    {
      message: "End date must be after start date",
      path: ["endDate"],
    }
  )
  .refine(
    (data) => {
      if (data.startDate) {
        const parts = data.startDate.split("-");
        return parts[0] && parts[0].length === 4;
      }
      return true;
    },
    {
      message: "Start date year must be 4 digits",
      path: ["startDate"],
    }
  )
  .refine(
    (data) => {
      if (data.endDate) {
        const parts = data.endDate.split("-");
        return parts[0] && parts[0].length === 4;
      }
      return true;
    },
    {
      message: "End date year must be 4 digits",
      path: ["endDate"],
    }
  );

type ContactRoleFormData = z.infer<typeof contactRoleSchema>;

interface ContactRoleDialogProps {
  contactId: number;
  contactName?: string;
  contactEmail?: string;
  triggerButton?: React.ReactNode;
}

export default function ContactRoleDialog(props: ContactRoleDialogProps) {
  const { contactId, contactName, contactEmail, triggerButton } = props;
  const [open, setOpen] = useState(false);
  const [customRole, setCustomRole] = useState("");

  const { data: contactData, isLoading: isLoadingContact } =
    useContactDetailsQuery(contactId);

  const effectiveContactName =
    contactName || (contactData?.contact.fullName ?? `Contact #${contactId}`);
  const effectiveContactEmail = contactEmail || contactData?.contact.email;

  const createContactRoleMutation = useCreateContactRoleMutation();

  const form = useForm<ContactRoleFormData>({
    resolver: zodResolver(contactRoleSchema),
    defaultValues: {
      contactId,
      roleName: "",
      startDate: new Date().toISOString().split("T")[0],
      endDate: "",
      isActive: true,
      notes: "",
    },
  });

  const resetForm = () => {
    form.reset({
      contactId,
      roleName: "",
      startDate: new Date().toISOString().split("T")[0],
      endDate: "",
      isActive: true,
      notes: "",
    });
    setCustomRole("");
  };

  const onSubmit = async (data: ContactRoleFormData) => {
    try {
      const finalData = {
        ...data,
        roleName: data.roleName === "custom" ? customRole : data.roleName,
      };

      await createContactRoleMutation.mutateAsync(finalData);
      resetForm();
      setOpen(false);
    } catch (error) {
      console.error("Error creating contact role:", error);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
    }
  };

  const selectedRole = form.watch("roleName");
  const isCustomRole = selectedRole === "custom";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {triggerButton || (
          <Button size="sm" variant="outline" className="border-dashed">
            <UserPlus className="w-4 h-4 mr-2" />
            Add Role
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Contact Role</DialogTitle>
          <DialogDescription>
            {isLoadingContact ? (
              "Loading contact details..."
            ) : (
              <div>
                Assign a role to: {effectiveContactName}
                {effectiveContactEmail && (
                  <span className="block mt-1 text-sm text-muted-foreground">
                    {effectiveContactEmail}
                  </span>
                )}
                {contactData?.activeRoles &&
                  contactData.activeRoles.length > 0 && (
                    <div className="mt-2">
                      <span className="text-sm text-muted-foreground">
                        Current roles:{" "}
                        {contactData.activeRoles
                          .map((role) => role.roleName)
                          .join(", ")}
                      </span>
                    </div>
                  )}
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <div className="space-y-4">
            <FormField
              control={form.control}
              name="roleName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role *</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {commonRoles.map((role) => (
                        <SelectItem key={role} value={role}>
                          {role}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom Role...</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {isCustomRole && (
              <div>
                <FormLabel>Custom Role Name *</FormLabel>
                <Input
                  placeholder="Enter custom role name"
                  value={customRole}
                  onChange={(e) => setCustomRole(e.target.value)}
                  className="mt-2"
                />
                {isCustomRole && !customRole && (
                  <p className="text-sm text-destructive mt-1">
                    Custom role name is required
                  </p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="startDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Start Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} onChange={(e) => {
                        const value = e.target.value;
                        if (value) {
                          const parts = value.split("-");
                          if (parts[0] && parts[0].length > 4) {
                            return;
                          }
                        }
                        field.onChange(value);
                      }} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="endDate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>End Date</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} onChange={(e) => {
                        const value = e.target.value;
                        if (value) {
                          const parts = value.split("-");
                          if (parts[0] && parts[0].length > 4) {
                            return;
                          }
                        }
                        field.onChange(value);
                      }} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel>Active Role</FormLabel>
                    <p className="text-sm text-muted-foreground">
                      Whether this role is currently active
                    </p>
                  </div>
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      placeholder="Additional notes about this role"
                      rows={3}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
              <h4 className="font-medium text-blue-900 mb-2">Role Summary</h4>
              <div className="text-sm text-blue-800 space-y-1">
                <div>
                  Role:{" "}
                  {isCustomRole
                    ? customRole || "Custom role"
                    : selectedRole || "Not selected"}
                </div>
                <div>
                  Status: {form.watch("isActive") ? "Active" : "Inactive"}
                </div>
                {form.watch("startDate") && (
                  <div>
                    Start Date:{" "}
                    {new Date(
                      form.watch("startDate") as any
                    ).toLocaleDateString()}
                  </div>
                )}
                {form.watch("endDate") && (
                  <div>
                    End Date:{" "}
                    {new Date(
                      form.watch("endDate") as any
                    ).toLocaleDateString()}
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-4 border-t">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={createContactRoleMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={form.handleSubmit(onSubmit)}
                disabled={
                  createContactRoleMutation.isPending ||
                  isLoadingContact ||
                  (isCustomRole && !customRole)
                }
                className="text-white"
              >
                {createContactRoleMutation.isPending ? "Adding..." : "Add Role"}
              </Button>
            </div>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
