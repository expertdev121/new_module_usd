"use client";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { LogOut, Users, Home, UserCog, FolderOpen, CreditCard, FileText, Target, Tag, BarChart3, Building2, UserCheck, User, Upload, PlayCircle, Plug, Activity, UserMinus, HandCoins, type LucideIcon } from "lucide-react";

type NavItem = { path: string; label: string; icon: LucideIcon };
type NavGroup = { title: string | null; items: NavItem[] };

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = session?.user?.role;
  const trialEndsAt = session?.user?.trialEndsAt;
  const [now, setNow] = useState(Date.now());

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/auth/login" });
  };

  useEffect(() => {
    // Show the countdown to every logged-in user of a trial account,
    // not just the admin. Regular users of the tenant deserve the same
    // heads-up about when access is locking down.
    if (session?.user?.accessType !== "trial" || !trialEndsAt) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [session, trialEndsAt]);

  const trialTimer = useMemo(() => {
    if (
      session?.user?.role !== "admin" ||
      session.user.accessType !== "trial" ||
      !trialEndsAt
    ) {
      return null;
    }

    const remainingMs = Math.max(new Date(trialEndsAt).getTime() - now, 0);
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return {
      expired: remainingMs <= 0,
      label: `${days}d ${hours}h ${minutes}m ${seconds}s`,
      endsAtLabel: new Date(trialEndsAt).toLocaleString(),
    };
  }, [now, session, trialEndsAt]);

  const isActive = (path: string) => {
    if (path === "/contacts") {
      return pathname.startsWith("/contacts");
    }
    if (path === "/pledges") {
      return pathname.startsWith("/pledges");
    }
    return pathname === path;
  };

  /* Navigation is grouped — uppercase section labels separate workspace
     items, things you manage, and account-level controls. Super admin
     stays as a single ungrouped list because it only has 4 items. */
  const getNavigationGroups = (): NavGroup[] => {
    if (userRole === "super_admin") {
      return [
        {
          title: null,
          items: [
            { path: "/admin/profile", label: "Profile", icon: User },
            { path: "/admin/manage-admins", label: "Manage Admins", icon: UserCog },
            { path: "/admin/organization-names", label: "Organization Names", icon: Building2 },
            { path: "/admin/log-reports", label: "Log Reports", icon: FileText },
            { path: "/admin/ghl-webhook-logs", label: "GHL Webhook Logs", icon: Activity },
            { path: "/admin/offboard-clients", label: "Offboard Clients", icon: UserMinus },
          ],
        },
      ];
    }
    return [
      {
        title: "Workspace",
        items: [
          { path: "/admin/profile", label: "Profile", icon: User },
          { path: "/dashboard", label: "Dashboard Home", icon: Home },
          { path: "/contacts", label: "Financial Module", icon: Users },
          { path: "/admin/reports", label: "Reports", icon: BarChart3 },
        ],
      },
      {
        title: "Manage",
        items: [
          { path: "/admin/campaigns", label: "Manage Campaigns", icon: Target },
          { path: "/admin/users", label: "Manage Users", icon: UserCog },
          { path: "/admin/merge-contacts", label: "Merge Contacts", icon: Users },
          { path: "/admin/categories", label: "Manage Categories", icon: FolderOpen },
          { path: "/admin/payment-methods", label: "Payment Methods", icon: CreditCard },
          { path: "/admin/tags", label: "Manage Tags", icon: Tag },
          { path: "/admin/solicitors", label: "Solicitors", icon: UserCheck },
          { path: "/admin/accounts", label: "Accounts", icon: Building2 },
          { path: "/admin/manual-donations/upload", label: "Manual Donation Upload", icon: Upload },
        ],
      },
      {
        title: "Account",
        items: [
          { path: "/admin/connections", label: "Connections", icon: Plug },
          { path: "/admin/crowded", label: "Donation Forms", icon: HandCoins },
          { path: "/admin/manage-subscription", label: "Manage Subscription", icon: CreditCard },
          { path: "/admin/log-reports", label: "Audit Log", icon: FileText },
        ],
      },
    ];
  };

  const navigationGroups = getNavigationGroups();

  /* Active-state classes — subtle muted tint, foreground text bumped to
     semibold, plus a 3px primary-colored stripe on the left edge that runs
     just shy of full row height (top-1.5 bottom-1.5 = 6px inset top and
     bottom). Inactive rows are quiet ghost rows that hover to a soft tint.
     This is the GitHub / Linear / Notion premium dashboard pattern. */
  const navItemClass = (active: boolean) =>
    cn(
      "relative flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-3 text-sm transition-colors",
      active
        ? "bg-muted font-semibold text-foreground before:absolute before:left-0 before:top-1.5 before:bottom-1.5 before:w-[3px] before:rounded-r-full before:bg-primary"
        : "font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground",
    );

  return (
    /* Professional sidebar — pure white card surface against the gray page,
       single right border, no shadow. The contrast comes from the
       background difference, not from chrome. */
    <aside className="flex h-full w-56 flex-col overflow-hidden border-r bg-card">
      {/* Logo */}
      <div className="flex shrink-0 items-center justify-center px-4 pt-5 pb-4">
        <img
          src="https://storage.googleapis.com/msgsndr/0lb5xbd0qHmaEqPUPc2N/media/f179ef7a-75f3-4c56-9fdd-85bc428972fb.png"
          alt="Company Logo"
          className="h-12 w-auto"
        />
      </div>

      {trialTimer && (
        <div className="mx-3 mb-3 shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950">
          <div className="text-sm font-semibold">Free Trial</div>
          <div className="mt-0.5 text-xs">
            {trialTimer.expired ? "Expired" : `${trialTimer.label} remaining`}
          </div>
          <div className="mt-0.5 text-xs text-amber-800">
            Expires {trialTimer.endsAtLabel}
          </div>
        </div>
      )}

      {/* Grouped scrollable nav. */}
      <nav className="no-scrollbar flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {navigationGroups.map((group, groupIndex) => (
          <div
            key={group.title ?? `group-${groupIndex}`}
            className={cn(groupIndex > 0 && "mt-4")}
          >
            {group.title && (
              <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {group.title}
              </p>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(item.path);
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    title={item.label}
                    className={navItemClass(active)}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer — Watch Course + Sign Out, sharing the same nav-row styling. */}
      <div className="shrink-0 space-y-0.5 border-t px-2 py-2">
        <Link
          href="/admin/onboarding"
          title="Watch Course"
          className={navItemClass(isActive("/admin/onboarding"))}
        >
          <PlayCircle className="h-4 w-4 shrink-0" />
          <span className="truncate">Watch Course</span>
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className={cn(navItemClass(false), "text-left")}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          <span className="truncate">Sign Out</span>
        </button>
      </div>
    </aside>
  );
}
