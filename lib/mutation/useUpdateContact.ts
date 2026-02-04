import { ContactFormValues } from "@/components/forms/contact-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClientErrorHandler, ApiError } from "@/lib/error-handler";

async function updateContact(contactId: number, data: ContactFormValues) {
  const response = await fetch(`/api/contacts/${contactId}`, {
    method: "PUT",
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

export function useUpdateContact(
  setFieldError?: (field: string, message: string) => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, data }: { contactId: number; data: ContactFormValues }) =>
      updateContact(contactId, data),
    onSuccess: (data, variables) => {
      console.log("Mutation success, updating query data for contact:", data.contact.id, "variables:", variables);
      toast.success("Contact updated successfully!");

      // Update the query data directly for immediate UI update
      queryClient.setQueryData(["contact", variables.contactId], (oldData: any) => {
        if (oldData) {
          console.log("Updating query data from:", oldData.contact, "to:", data.contact);
          return {
            ...oldData,
            contact: {
              ...oldData.contact,
              ...data.contact,
            },
          };
        }
        return oldData;
      });

      // Also invalidate to ensure consistency
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error: ApiError) => {
      const errorMessage = ClientErrorHandler.handle(error, setFieldError);
      toast.error(errorMessage);
    },
  });
}
