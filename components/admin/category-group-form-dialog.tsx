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
import { categoryGroupSchema } from "@/lib/form-schemas/category-group";
import { toast } from "sonner";

type CategoryGroupFormData = z.infer<typeof categoryGroupSchema>;

interface CategoryGroup {
  id: number;
  name: string;
  categoryId: number;
  categoryName?: string;
  categoryItemId: number;
  categoryItemName?: string;
  createdAt: string;
  updatedAt: string;
}

interface Category {
  id: number;
  name: string;
}

interface CategoryItem {
  id: number;
  name: string;
  categoryId: number;
}

interface CategoryGroupFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  group?: CategoryGroup | null;
  categories: Category[];
  items: CategoryItem[];
  onSuccess: () => void;
}

export function CategoryGroupFormDialog({
  open,
  onOpenChange,
  group,
  categories,
  items,
  onSuccess,
}: CategoryGroupFormDialogProps) {
  const [loading, setLoading] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const isEditing = !!group;

  const form = useForm<CategoryGroupFormData>({
    resolver: zodResolver(categoryGroupSchema),
    defaultValues: {
      name: "",
      categoryId: 0,
      categoryItemId: 0,
    },
  });

  useEffect(() => {
    if (group) {
      form.reset({
        name: group.name,
        categoryId: group.categoryId,
        categoryItemId: group.categoryItemId,
      });
      setSelectedCategoryId(group.categoryId);
    } else {
      form.reset({
        name: "",
        categoryId: 0,
        categoryItemId: 0,
      });
      setSelectedCategoryId(null);
    }
  }, [group, form]);

  const filteredItems = selectedCategoryId
    ? items.filter(item => item.categoryId === selectedCategoryId)
    : items;

  const onSubmit = async (data: CategoryGroupFormData) => {
    setLoading(true);
    try {
      const url = isEditing ? `/api/category-groups/${group.id}` : "/api/category-groups";
      const method = isEditing ? "PUT" : "POST";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify(data),
      });

      if (response.ok) {
        toast.success(
          `Category group ${isEditing ? "updated" : "created"} successfully`
        );
        onSuccess();
        onOpenChange(false);
        form.reset();
      } else {
        const error = await response.json();
        toast.error(error.message || "Failed to save category group");
      }
    } catch (error) {
      toast.error("An error occurred while saving the category group");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Category Group" : "Add Category Group"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the category group details below."
              : "Create a new category group by filling out the form below."}
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
                    <Input placeholder="Category group name" {...field} />
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
                  <Select
                    onValueChange={(value) => {
                      const categoryId = parseInt(value);
                      field.onChange(categoryId);
                      setSelectedCategoryId(categoryId);
                      // Reset category item selection when category changes
                      form.setValue("categoryItemId", 0);
                    }}
                    value={field.value?.toString()}
                  >
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
              name="categoryItemId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Category Item</FormLabel>
                  <Select onValueChange={(value) => field.onChange(parseInt(value))} value={field.value?.toString()}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a category item" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent className="max-h-60 overflow-y-auto">
                      {filteredItems.map((item) => (
                        <SelectItem key={item.id} value={item.id.toString()}>
                          {item.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
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
