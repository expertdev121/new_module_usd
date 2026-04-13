import type { DefaultSession } from "next-auth";
import NextAuth from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      role: string;
      contactId?: string;
      locationId?: string;
      ipAddress?: string;
      userAgent?: string;
      accessType: "full" | "trial";
      trialEndsAt?: string;
      trialExpired: boolean;
      trialDays?: number;
    } & DefaultSession["user"];
  }

  interface User {
    id: string;
    email: string;
    role: string;
    contactId?: string;
    locationId?: string;
    ipAddress?: string;
    userAgent?: string;
    accessType: "full" | "trial";
    trialEndsAt?: string;
    trialExpired: boolean;
    trialDays?: number;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: string;
    contactId?: string;
    locationId?: string;
    ipAddress?: string;
    userAgent?: string;
    accessType?: "full" | "trial";
    trialEndsAt?: string;
    trialExpired?: boolean;
    trialDays?: number;
  }
}
