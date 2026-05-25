import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { user, contact } from "@/lib/db/schema";
import { getTrialAccessState } from "@/lib/trial";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export const authOptions: NextAuthOptions = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: DrizzleAdapter(db) as any,

  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const users = await db
          .select({
            id: user.id,
            email: user.email,
            passwordHash: user.passwordHash,
            role: user.role,
            status: user.status,
            accessType: user.accessType,
            createdAt: user.createdAt,
            locationId: user.locationId,
            deletedAt: user.deletedAt,
          })
          .from(user)
          .where(eq(user.email, credentials.email))
          .limit(1);

        if (users.length === 0) return null;

        const foundUser = users[0];
        const isValid = await bcrypt.compare(credentials.password, foundUser.passwordHash);
        if (!isValid) return null;

        if (foundUser.status === "suspended") {
          throw new Error("Your account has been suspended. Please contact an administrator.");
        }

        // Soft-deleted users (location offboarded via /admin/offboard-clients)
        // cannot log in until a super admin restores them. We deliberately
        // surface a different message from "suspended" so the user knows
        // to contact the org owner, not us.
        if (foundUser.deletedAt) {
          throw new Error(
            "Your organization has been offboarded from DonorHQ. Contact your administrator to restore access.",
          );
        }

        const contacts = await db
          .select({ id: contact.id })
          .from(contact)
          .where(eq(contact.email, foundUser.email))
          .limit(1);
        const contactId = contacts.length > 0 ? contacts[0].id : null;

        const trialAccess = getTrialAccessState({
          accessType: foundUser.accessType,
          createdAt: foundUser.createdAt,
        });

        return {
          id: foundUser.id.toString(),
          email: foundUser.email,
          role: foundUser.role,
          contactId: contactId?.toString(),
          locationId: foundUser.locationId ?? undefined,
          accessType: trialAccess.accessType,
          trialEndsAt: trialAccess.trialEndsAt ?? undefined,
          trialExpired: trialAccess.trialExpired,
          trialDays: trialAccess.trialDays,
          graceEndsAt: trialAccess.graceEndsAt ?? undefined,
          graceRemainingMs: trialAccess.graceRemainingMs ?? undefined,
          graceDays: trialAccess.graceDays,
          deletionScheduledAt: trialAccess.deletionScheduledAt ?? undefined,
          deletionRetentionDays: trialAccess.deletionRetentionDays,
          accessLocked: trialAccess.accessLocked,
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  // SameSite=None required for auth cookies to work inside cross-origin iframes.
  // Secure is required whenever SameSite=None is set (browser spec).
  cookies: {
    sessionToken: {
      name: process.env.NODE_ENV === "production"
        ? "__Secure-next-auth.session-token"
        : "next-auth.session-token",
      options: {
        httpOnly: true,
        sameSite: "none" as const,
        path: "/",
        secure: true,
      },
    },
    callbackUrl: {
      name: process.env.NODE_ENV === "production"
        ? "__Secure-next-auth.callback-url"
        : "next-auth.callback-url",
      options: {
        httpOnly: false,
        sameSite: "none" as const,
        path: "/",
        secure: true,
      },
    },
    csrfToken: {
      name: process.env.NODE_ENV === "production"
        ? "__Host-next-auth.csrf-token"
        : "next-auth.csrf-token",
      options: {
        httpOnly: true,
        sameSite: "none" as const,
        path: "/",
        secure: true,
      },
    },
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.contactId = user.contactId;
        token.locationId = user.locationId;
        token.accessType = user.accessType;
        token.trialEndsAt = user.trialEndsAt;
        token.trialDays = user.trialDays;
        token.graceEndsAt = user.graceEndsAt;
        token.graceRemainingMs = user.graceRemainingMs;
        token.graceDays = user.graceDays;
        token.deletionScheduledAt = user.deletionScheduledAt;
        token.deletionRetentionDays = user.deletionRetentionDays;
        token.accessLocked = user.accessLocked;
      }

      if (token.accessType === "trial" && token.trialEndsAt) {
        const trialState = getTrialAccessState({
          accessType: token.accessType,
          createdAt:
            token.trialDays && token.trialEndsAt
              ? new Date(
                  new Date(token.trialEndsAt).getTime() -
                    token.trialDays * 24 * 60 * 60 * 1000
                )
              : null,
        });
        token.trialExpired = trialState.trialExpired;
        token.graceEndsAt = trialState.graceEndsAt ?? undefined;
        token.graceRemainingMs = trialState.graceRemainingMs ?? undefined;
        token.graceDays = trialState.graceDays;
        token.deletionScheduledAt = trialState.deletionScheduledAt ?? undefined;
        token.deletionRetentionDays = trialState.deletionRetentionDays;
        token.accessLocked = trialState.accessLocked;
      } else {
        token.trialExpired = false;
        token.graceEndsAt = undefined;
        token.graceRemainingMs = undefined;
        token.graceDays = undefined;
        token.deletionScheduledAt = undefined;
        token.deletionRetentionDays = undefined;
        token.accessLocked = false;
      }

      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.sub!;
        session.user.role = token.role as string;
        session.user.contactId = token.contactId as string;
        session.user.locationId = token.locationId as string;
        session.user.accessType = (token.accessType as "full" | "trial") ?? "full";
        session.user.trialEndsAt = token.trialEndsAt as string | undefined;
        session.user.trialDays = token.trialDays as number | undefined;
        session.user.trialExpired = Boolean(token.trialExpired);
        session.user.graceEndsAt = token.graceEndsAt as string | undefined;
        session.user.graceRemainingMs = token.graceRemainingMs as number | undefined;
        session.user.graceDays = token.graceDays as number | undefined;
        session.user.deletionScheduledAt = token.deletionScheduledAt as string | undefined;
        session.user.deletionRetentionDays = token.deletionRetentionDays as number | undefined;
        session.user.accessLocked = Boolean(token.accessLocked);
      }
      return session;
    },
    async redirect({ baseUrl }) {
      return `${baseUrl}/dashboard`;
    },
  },

  pages: {
    signIn: "/auth/login",
  },

  debug: true,
  secret: process.env.NEXTAUTH_SECRET,
};
