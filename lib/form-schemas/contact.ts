import { z } from "zod";

export const contactFormSchema = z.object({
  firstName: z
    .string()
    .min(1, { message: "First name is required" })
    .max(64, { message: "First name must be at most 64 characters" }),
  lastName: z
    .string()
    .min(1, { message: "Last name is required" })
    .max(64, { message: "Last name must be at most 64 characters" }),
  displayName: z
    .string()
    .max(64, { message: "Display name must be at most 64 characters" })
    .optional(),
  email: z.string().refine((val) => val === "" || z.string().email().safeParse(val).success, {
    message: "Invalid email address",
  }).optional(),
  phone: z.string().optional(),
  gender: z.enum(["male", "female"]).optional(),
  address: z.string().optional(),
  tagIds: z.array(z.number()).optional(),
});
