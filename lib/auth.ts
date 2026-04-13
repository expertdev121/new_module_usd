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
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
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
      }

      if (token.accessType === "trial" && token.trialEndsAt) {
        token.trialExpired = new Date(token.trialEndsAt).getTime() <= Date.now();
      } else {
        token.trialExpired = false;
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
        session.user.trialExpired =
          token.accessType === "trial" && token.trialEndsAt
            ? new Date(token.trialEndsAt as string).getTime() <= Date.now()
            : false;
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
  useSecureCookies: process.env.NODE_ENV === "production",
};
