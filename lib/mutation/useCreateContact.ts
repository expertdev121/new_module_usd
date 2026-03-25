import { ContactFormValues } from "@/components/forms/contact-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClientErrorHandler, ApiError } from "@/lib/error-handler";

async function createContact(data: ContactFormValues) {
  // Handle tagIds: create contact_tags entries if provided
  const { tagIds, ...contactData } = data;
  
  const response = await fetch("/api/contacts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(contactData), // Don't send tagIds to contact endpoint
  });
  if (!response.ok) {
    const error: ApiError = await response.json();
    throw error;
  }
  
  const result = await response.json();
  const newContactId = result.contact.id;
  
  // Add tags if provided
  if (tagIds && tagIds.length > 0) {
    for (const tagId of tagIds) {
      await fetch(`/api/contacts/${newContactId}/tags`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tagId }),
      });
      // Audit log
      await fetch('/api/admin/log-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TAG_CONTACT_ADD',
          details: { contactId: newContactId, tagId }
        }),
      });
    }
  }
  
  return result;

}

export function useCreateContact(
  setFieldError?: (field: string, message: string) => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createContact,
    onSuccess: () => {
      toast.success("Contact created successfully!");
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
    },
    onError: (error: ApiError) => {
      const errorMessage = ClientErrorHandler.handle(error, setFieldError);
      toast.error(errorMessage);
    },
  });
}
