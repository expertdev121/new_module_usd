import { withAuth } from "next-auth/middleware";

export default withAuth(
  function middleware(req) {
    // Custom middleware logic can be added here if needed
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        if (!token) return false;

        const { pathname } = req.nextUrl;

        // Super admin can access all routes
        if (token.role === "super_admin") return true;

        // Regular admin routes
        if (pathname.startsWith("/admin")) {
          return token.role === "admin";
        }

        // Dashboard routes require admin or super_admin
        if (pathname.startsWith("/dashboard")) {
          return token.role === "admin" || token.role === "super_admin";
        }

        // Contacts routes
        if (pathname.startsWith("/contacts")) {
          // Allow admin/super_admin to access all contact routes
          if (token.role === "admin" || token.role === "super_admin") {
            return true;
          }

          // Allow users to access the main contacts page
          if (pathname === "/contacts") {
            return true;
          }

          // Allow users to access their own contact page and sub-routes
          const contactPathMatch = pathname.match(/^\/contacts\/(\d+)/);
          if (contactPathMatch && token.contactId === contactPathMatch[1]) {
            return true;
          }

          // Deny access to other contact routes for regular users
          return false;
        }

        // Default: authenticated users can access
        return !!token;
      },
    },
    pages: {
      signIn: "/auth/login",
    },
  }
);

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (NextAuth API routes)
     * - api/webhook (webhook endpoints)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - auth (auth routes like /auth/login)
     */
    "/((?!api/auth|api/webhook|_next/static|_next/image|favicon.ico|auth).*)",
  ],
};
