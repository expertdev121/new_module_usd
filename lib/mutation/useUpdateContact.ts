import { ContactFormValues } from "@/components/forms/contact-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ClientErrorHandler, ApiError } from "@/lib/error-handler";

async function updateContact(contactId: number, data: ContactFormValues) {
  // Handle tagIds sync
  const { tagIds, ...contactData } = data;
  
  const response = await fetch(`/api/contacts/${contactId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(contactData), // Contact data only
  });
  if (!response.ok) {
    const error: ApiError = await response.json();
    throw error;
  }
  
  // Sync tags if provided
  if (tagIds !== undefined) {
    const currentTagsResponse = await fetch(`/api/contacts/${contactId}`);
    const currentData = await currentTagsResponse.json();
    const currentTags = currentData.contact?.tags || [];
    const currentTagIds = currentTags.map((t: any) => t.id);
    
    // Add new tags
    const tagsToAdd = tagIds.filter((id: number) => !currentTagIds.includes(id));
    for (const tagId of tagsToAdd) {
      await fetch(`/api/contacts/${contactId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
      });
      // Audit log
      await fetch('/api/admin/log-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TAG_CONTACT_ADD',
          details: { contactId, tagId }
        }),
      });
    }
    
    // Remove missing tags
    const tagsToRemove = currentTagIds.filter((id: number) => !tagIds.includes(id));
    for (const tagId of tagsToRemove) {
      await fetch(`/api/contacts/${contactId}/tags`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
      });
      // Audit log
      await fetch('/api/admin/log-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'TAG_CONTACT_REMOVE',
          details: { contactId, tagId }
        }),
      });
    }
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
