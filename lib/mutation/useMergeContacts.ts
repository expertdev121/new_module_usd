import { MergeContactsFormData } from "@/lib/form-schemas/merge-contacts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClientErrorHandler, ApiError } from "@/lib/error-handler";

async function mergeContacts(data: MergeContactsFormData) {
  const response = await fetch("/api/contacts/merge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error: ApiError = await response.json();
    throw error;
  }
  return response.json();
}

export function useMergeContacts(
  setFieldError?: (field: string, message: string) => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: mergeContacts,
    onSuccess: () => {
      toast.success("Contacts merged successfully!");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["contact-details"] });
    },
    onError: (error: ApiError) => {
      const errorMessage = ClientErrorHandler.handle(error, setFieldError);
      toast.error(errorMessage);
    },
  });
}
