import { NextResponse } from "next/server";
import { withAuth } from "next-auth/middleware";

export default withAuth(
  function middleware(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    const isExpiredTrialAdmin =
      token?.role === "admin" &&
      token?.accessType === "trial" &&
      typeof token?.trialEndsAt === "string" &&
      new Date(token.trialEndsAt).getTime() <= Date.now();

    if (isExpiredTrialAdmin && pathname.startsWith("/api")) {
      return NextResponse.json(
        {
          error: "Free trial expired",
          message: "Free access has expired. Upgrade to restore API access.",
        },
        { status: 403 }
      );
    }
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
          if (token.role === "admin" || token.role === "super_admin") {
            return true;
          }

          if (pathname === "/contacts") {
            return true;
          }

          const contactPathMatch = pathname.match(/^\/contacts\/(\d+)/);
          if (contactPathMatch && token.contactId === contactPathMatch[1]) {
            return true;
          }

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
     * - api/zapier (Zapier API endpoints)
     * - api/google-daily-sync (Google Sheets sync API)
     * - api/payroc (Payroc payment API)
     * - api/send-receipt (public send receipt API)
     * - api/receipts (public receipts API)
     * - api/year-end-letters (public year-end letters API)
     * - api/oauth (GHL OAuth install/callback — must be public; users arrive
     *              from the GHL Marketplace without a Donor HQ session)
     * - oauth (public success/error pages for the GHL OAuth flow)
     * - receipts (public PDF receipts)
     * - payroc-public (public payment form page)
     * - cmn-campaigns, cmn-stripe-config, cmn-create-payment-intent,
     *   cmn-create-campaign-payment-intent, cmn-webhook (CMN public APIs)
     * - cmn-campaigns-form.html, cmn-donation-form.html (CMN public donor forms)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - auth (auth routes like /auth/login)
     */
    "/((?!api/auth|api/webhook|api/zapier|api/google-daily-sync|api/payroc|api/send-receipt|api/receipts|api/year-end-letters|api/oauth|api/public|api/admin/backfill/cron|oauth|donate|embed|receipts/|payroc-public|chat|create-payment-intent|stripe-config|webhook|stripe-payment-form.html|chaplains-donation-form.html|cmn-campaigns|cmn-stripe-config|cmn-create-payment-intent|cmn-create-campaign-payment-intent|cmn-webhook|cmn-campaigns-form.html|cmn-donation-form.html|_next/static|_next/image|favicon.ico|auth).*)",
  ],
};
