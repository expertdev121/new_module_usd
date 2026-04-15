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
      graceEndsAt?: string;
      graceRemainingMs?: number;
      graceDays?: number;
      deletionScheduledAt?: string;
      deletionRetentionDays?: number;
      accessLocked?: boolean;
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
    graceEndsAt?: string;
    graceRemainingMs?: number;
    graceDays?: number;
    deletionScheduledAt?: string;
    deletionRetentionDays?: number;
    accessLocked?: boolean;
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
    graceEndsAt?: string;
    graceRemainingMs?: number;
    graceDays?: number;
    deletionScheduledAt?: string;
    deletionRetentionDays?: number;
    accessLocked?: boolean;
  }
}
