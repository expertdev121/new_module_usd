import { z } from "zod";

export const mergeContactsSchema = z.object({
  sourceContactIds: z.array(z.number()).min(1, "At least one source contact must be selected"),
  targetContactId: z.number().min(1, "Target contact must be selected"),
  displayName: z.string().min(1, "Display name is required"),
  email: z.string().email("Valid email is required"),
});

export type MergeContactsFormData = z.infer<typeof mergeContactsSchema>;
