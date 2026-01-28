import { useQuery } from "@tanstack/react-query";
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
