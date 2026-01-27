export interface CategoryData {
  id: number;
  name: string;
  description: string;
  items: CategoryItem[];
}

export interface CategoryItem {
  id: number;
  name: string;
  occId?: string;
}

// Direct API call function - replaces STATIC_CATEGORIES entirely
export const getCategoryItems = async (categoryId: number): Promise<CategoryItem[]> => {
  try {
    const response = await fetch(`/api/categories/${categoryId}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch category items: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error fetching category items:', error);
    return [];
  }
};

// Remove getCategoryById since we're only fetching items from the API
// Remove STATIC_CATEGORIES entirely
// The CategoryData interface is kept in case you need it elsewhere
