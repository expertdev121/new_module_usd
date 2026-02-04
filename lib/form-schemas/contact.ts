import { z } from "zod";

export const contactFormSchema = z.object({
  displayName: z
    .string()
    .min(2, { message: "Full name must be at least 2 characters" })
    .max(64, { message: "Full name must be at most 64 characters" }),
  email: z.string().refine((val) => val === "" || z.string().email().safeParse(val).success, {
    message: "Invalid email address",
  }).optional(),
  phone: z.string().optional(),
  gender: z.enum(["male", "female"]).optional(),
  address: z.string().optional(),
});
