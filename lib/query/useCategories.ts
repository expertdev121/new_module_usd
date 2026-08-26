import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

export interface Category {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  items?: CategoryItem[];
}

export interface CategoryItem {
  id: number;
  name: string;
  occId?: string;
}

export function useCategories() {
  return useQuery<Category[]>({
    queryKey: ["categories"],
    queryFn: async () => {
      const response = await axios.get("/api/categories?limit=1000");
      const categories = response.data.categories;

      // Fetch items for each category
      const categoriesWithItems = await Promise.all(
        categories.map(async (category: Category) => {
          try {
            const itemsResponse = await axios.get(`/api/categories/${category.id}`);
            return {
              ...category,
              items: itemsResponse.data,
            };
          } catch (error) {
            console.error(`Failed to fetch items for category ${category.id}:`, error);
            return {
              ...category,
              items: [],
            };
          }
        })
      );

      return categoriesWithItems;
    },
    retry: 2,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

/**
 * Create a category inline (used by the "type + Enter to create" affordance in
 * the pledge form's Category dropdown). Server injects locationId from session.
 * Returns the created category row; invalidates the categories list.
 */
export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation<Category, Error, { name: string; description?: string }>({
    mutationFn: async (data) => {
      const response = await axios.post("/api/categories", data);
      return response.data.category as Category;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}
