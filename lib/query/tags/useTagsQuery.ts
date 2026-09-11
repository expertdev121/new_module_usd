import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { tag, Tag, NewTag } from "@/lib/db/schema";

export interface TagQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  isActive?: boolean;
  showOnPayment?: boolean;
  showOnPledge?: boolean;
}

export interface TagsResponse {
  tags: Tag[];
  pagination: {
    page: number;
    limit: number;
    totalCount: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
  filters: TagQueryParams;
}

export interface CreateTagData {
  name: string;
  description?: string;
  showOnPayment?: boolean;
  showOnPledge?: boolean;
  isActive?: boolean;
}

export interface CreateTagResponse {
  message: string;
  tag: Tag;
}

export interface UpdateTagData {
  tagId: number;
  name?: string;
  description?: string;
  showOnPayment?: boolean;
  showOnPledge?: boolean;
  isActive?: boolean;
}

export interface UpdateTagResponse {
  message: string;
  tag: Tag;
}

export interface DeleteTagData {
  tagId: number;
}

export interface DeleteTagResponse {
  message: string;
  deletedTag: {
    id: number;
    name: string;
  };
}

const fetchTags = async (params: TagQueryParams): Promise<TagsResponse> => {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.append(key, value.toString());
    }
  });

  const response = await fetch(`/api/tags?${searchParams.toString()}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch tags: ${response.statusText}`);
  }
  return response.json();
};

const createTag = async (data: CreateTagData): Promise<CreateTagResponse> => {
  const response = await fetch("/api/tags", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `Failed to create tag: ${response.statusText}`);
  }
  return response.json();
};

const updateTag = async (data: UpdateTagData): Promise<UpdateTagResponse> => {
  const response = await fetch(`/api/tags/${data.tagId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `Failed to update tag: ${response.statusText}`);
  }
  return response.json();
};

const deleteTag = async (data: DeleteTagData): Promise<DeleteTagResponse> => {
  const response = await fetch(`/api/tags/${data.tagId}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `Failed to delete tag: ${response.statusText}`);
  }
  return response.json();
};

export const tagKeys = {
  all: ["tags"] as const,
  lists: () => [...tagKeys.all, "list"] as const,
  list: (params: TagQueryParams) => [...tagKeys.lists(), params] as const,
  details: () => [...tagKeys.all, "detail"] as const,
  detail: (id: number) => [...tagKeys.details(), id] as const,
};

export const useTagsQuery = (
  params: TagQueryParams = {},
  options?: {
    enabled?: boolean;
    refetchInterval?: number;
    staleTime?: number;
  }
) => {
  // Tag pickers (payment / pledge / contact tag selectors) consume this hook
  // to list ALL applicable tags — they don't paginate. The /api/tags default
  // page size is 10, so without an explicit limit a location with >10 tags
  // would only ever see the first 10 ("tags set to show but not all showing").
  // Default to the API max (1000) unless a caller explicitly asks to paginate.
  const effectiveParams: TagQueryParams = { limit: 1000, ...params };
  return useQuery({
    queryKey: tagKeys.list(effectiveParams),
    queryFn: () => fetchTags(effectiveParams),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval,
    staleTime: options?.staleTime ?? 1000 * 60 * 5,
    gcTime: 1000 * 60 * 30,
  });
};

export const useCreateTagMutation = (options?: {
  onSuccess?: (data: CreateTagResponse) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTag,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      console.error("Error creating tag:", error);
      options?.onError?.(error);
    },
  });
};

export const useUpdateTagMutation = (options?: {
  onSuccess?: (data: UpdateTagResponse) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateTag,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      console.error("Error updating tag:", error);
      options?.onError?.(error);
    },
  });
};

export const useDeleteTagMutation = (options?: {
  onSuccess?: (data: DeleteTagResponse) => void;
  onError?: (error: Error) => void;
}) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTag,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      options?.onSuccess?.(data);
    },
    onError: (error: Error) => {
      console.error("Error deleting tag:", error);
      options?.onError?.(error);
    },
  });
};