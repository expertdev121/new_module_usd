"use client";

import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/dashboard/sidebar";
import { CurrentBreadcrumb } from "@/components/current-page";

export function LayoutWrapper({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const shouldBlockExpiredTrialAdmin =
    session?.user?.role === "admin" &&
    session.user.accessType === "trial" &&
    session.user.accessLocked &&
    pathname !== "/admin/manage-subscription";

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
          {shouldBlockExpiredTrialAdmin ? (
            <div className="p-8 pointer-events-none blur-sm">
              <CurrentBreadcrumb />
              <div className="space-y-6 mt-6">
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
            <div className="p-8">
              <CurrentBreadcrumb />
              {children}
            </div>
          )}
        </main>
      </div>
    );
  }

  // Default layout for non-admin users
  return (
    <main className="container mx-auto py-8 max-w-7xl">
      <CurrentBreadcrumb />
      {children}
    </main>
  );
}
