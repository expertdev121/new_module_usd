/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { contactFormSchema } from "@/lib/form-schemas/contact";
import { useCreateContact } from "@/lib/mutation/useCreateContact";
import { useUpdateContact } from "@/lib/mutation/useUpdateContact";
import { useState, useEffect } from "react";
import { PlusCircleIcon } from "lucide-react";

export type ContactFormValues = z.infer<typeof contactFormSchema>;

interface ContactFormDialogProps {
  isEditMode?: boolean;
  contactData?: {
    id: number;
    displayName?: string;
    email: string;
    phone?: string;
    gender?: string;
    address?: string;
  };
  trigger?: React.ReactNode;
}

export default function ContactFormDialog({
  isEditMode = false,
  contactData,
  trigger
}: ContactFormDialogProps) {
  const [open, setOpen] = useState(false);
  const form = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      displayName: "",
      email: "",
      phone: "",
      gender: undefined,
      address: "",
    },
  });

  const { mutate: createContact, isPending: isCreating } = useCreateContact(
    form.setError as any
  );

  const { mutate: updateContact, isPending: isUpdating } = useUpdateContact(
    form.setError as any
  );

  // Set form values when in edit mode
  useEffect(() => {
    if (isEditMode && contactData && open) {
      form.reset({
        displayName: contactData.displayName || "",
        email: contactData.email || "",
        phone: contactData.phone || "",
        gender: contactData.gender as any || undefined,
        address: contactData.address || "",
      });
    } else if (!isEditMode && open) {
      form.reset({
        displayName: "",
        email: "",
        phone: "",
        gender: undefined,
        address: "",
      });
    }
  }, [isEditMode, contactData, open]);

  const onSubmit = (values: ContactFormValues) => {
    console.log("Form submitted with values:", values);
    console.log("isEditMode:", isEditMode, "contactData:", contactData);

    if (isEditMode && contactData) {
      console.log("Updating contact with ID:", contactData.id);
      updateContact(
        { contactId: contactData.id, data: values },
        {
          onSuccess: () => {
            console.log("Contact updated successfully");
            form.reset();
            setOpen(false);
          },
        }
      );
    } else {
      console.log("Creating new contact");
      createContact(values, {
        onSuccess: () => {
          console.log("Contact created successfully");
          form.reset();
          setOpen(false);
        },
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && (
        <DialogTrigger asChild>
          {trigger}
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            {isEditMode ? "Edit Contact" : "Creation of a Contact"}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="displayName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg">Full Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="John Doe"
                      className="h-12 text-base"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg">Email</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="you@example.com"
                      className="h-12 text-base"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="phone"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg">Phone</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="+1234567890"
                      className="h-12 text-base"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="gender"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg">Gender</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    value={field.value}
                  >
                    <FormControl>
                      <SelectTrigger className="h-12 text-base">
                        <SelectValue placeholder="Select gender" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-lg">Address</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="123 Main St, City, Country"
                      className="h-32 text-base"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-4">
              <Button
                type="button"
                variant="outline"
                className="h-12 text-lg"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className="h-12 text-lg"
                disabled={isCreating || isUpdating}
              >
                {(isCreating || isUpdating) ? "Submitting..." : (isEditMode ? "Update" : "Submit")}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
