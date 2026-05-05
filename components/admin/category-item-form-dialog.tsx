"use client";

import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { z } from "zod";
import { categoryItemSchema } from "@/lib/form-schemas/category-item";
import { toast } from "sonner";

type CategoryItemFormData = z.infer<typeof categoryItemSchema>;

interface CategoryItem {
  id: number;
  name: string;
  occId: number | null;
  categoryId: number;
  categoryName?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: number;
  name: string;
}

interface CategoryItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item?: CategoryItem | null;
  categories: Category[];
  onSuccess: () => void;
}

export function CategoryItemFormDialog({
  open,
  onOpenChange,
  item,
  categories,
  onSuccess,
}: CategoryItemFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const isEditing = !!item;

  const form = useForm<CategoryItemFormData>({
    resolver: zodResolver(categoryItemSchema),
    defaultValues: {
      name: "",
      occId: undefined,
      categoryId: 0,
      isActive: true,
    },
  });

  useEffect(() => {
    if (item) {
      form.reset({
        name: item.name,
        occId: item.occId || undefined,
        categoryId: item.categoryId,
        isActive: item.isActive,
      });
    } else {
      form.reset({
        name: "",
        occId: undefined,
        categoryId: 0,
        isActive: true,
      });
    }
  }, [item, form]);

  const onSubmit = async (data: CategoryItemFormData) => {
    setLoading(true);
    try {
      const submitData = {
        ...data,
        occId: data.occId || null,
      };

      const url = isEditing ? `/api/category-items/${item.id}` : "/api/category-items";
      const method = isEditing ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(submitData),
      });

      if (response.ok) {
        toast.success(
          `Category item ${isEditing ? "updated" : "created"} successfully`
        );
        onSuccess();
        onOpenChange(false);
        form.reset();
      } else {
        const error = await response.json();
        toast.error(error.message || "Failed to save category item");
      }
    } catch (error) {
      toast.error("An error occurred while saving the category item");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Category Item" : "Add Category Item"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the category item details below."
              : "Create a new category item by filling out the form below."}
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Category item name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="occId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>OCC ID (Optional)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      placeholder="OCC ID"
                      {...field}
                      onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : undefined)}
                      value={field.value || ""}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="categoryId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category</FormLabel>
                  <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      {categories.map((category) => (
                        <SelectItem key={category.id} value={category.id.toString()}>
                          {category.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Active</FormLabel>
                    <div className="text-sm text-muted-foreground">
                      Enable or disable this category item
                    </div>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : isEditing ? "Update" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
