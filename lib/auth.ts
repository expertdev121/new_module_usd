import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { user, contact } from "@/lib/db/schema";
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

        const userWithLocation = await db
          .select({ locationId: user.locationId })
          .from(user)
          .where(eq(user.id, foundUser.id))
          .limit(1);
        const locationId = userWithLocation.length > 0 ? userWithLocation[0].locationId : null;

        return {
          id: foundUser.id.toString(),
          email: foundUser.email,
          role: foundUser.role,
          contactId: contactId?.toString(),
          locationId: locationId ?? undefined,
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
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.sub!;
        session.user.role = token.role as string;
        session.user.contactId = token.contactId as string;
        session.user.locationId = token.locationId as string;
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
