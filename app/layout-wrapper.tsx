"use client";

import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { UserMenu } from "@/components/dashboard/user-menu";
import { ImpersonationBanner } from "@/components/dashboard/impersonation-banner";
import { CurrentBreadcrumb } from "@/components/current-page";

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const shouldBlockExpiredTrialAdmin =
    session?.user?.role === "admin" &&
    session.user.accessType === "trial" &&
    session.user.accessLocked &&
    pathname !== "/admin/manage-subscription";

  // Public donor pages and the auth screens (login, etc.) render fully
  // standalone — no sidebar, no breadcrumb, no max-width shell — so the login
  // can own the whole viewport. Skipping /donate here also makes the
  // admin-side <iframe src="/donate/[id]"> preview show only the form.
  if (pathname?.startsWith("/donate") || pathname?.startsWith("/auth")) {
    return <>{children}</>;
  }

  // Show loading state to prevent flash of wrong layout
  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  // Admin layout with sidebar
  if (session?.user?.role === "admin" || session?.user?.role === "super_admin") {
    return (
      <div className="flex h-screen">
        <div className={shouldBlockExpiredTrialAdmin ? "pointer-events-none blur-sm" : ""}>
          <Sidebar />
        </div>
        <main className="flex-1 overflow-y-auto">
          {/* Top bar — breadcrumb on the left, account menu on the right.
              Kept outside the trial blur so a locked-out admin can still
              reach Profile settings / Sign out. */}
          <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-background/85 px-4 sm:px-5 backdrop-blur supports-[backdrop-filter]:bg-background/60 [&_nav]:mb-0">
            <CurrentBreadcrumb />
            <UserMenu />
          </header>
          <ImpersonationBanner />
          {shouldBlockExpiredTrialAdmin ? (
            <div className="px-4 py-4 sm:px-5 pointer-events-none blur-sm">
              <div className="space-y-4 mt-4">
                <div className="h-10 w-64 rounded-md bg-muted" />
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="h-32 rounded-xl border bg-card" />
                  <div className="h-32 rounded-xl border bg-card" />
                  <div className="h-32 rounded-xl border bg-card" />
                </div>
                <div className="h-96 rounded-xl border bg-card" />
              </div>
            </div>
          ) : (
            <div className="px-4 py-4 sm:px-5">
              {children}
            </div>
          )}
        </main>
      </div>
    );
  }

  // Default layout for non-admin users
  return (
    <main className="mx-auto max-w-7xl px-4 py-4 sm:px-5">
      <CurrentBreadcrumb />
      {children}
    </main>
  );
}
