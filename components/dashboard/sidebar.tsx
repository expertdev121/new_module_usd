"use client";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { LogOut, Users, Home, UserCog, FolderOpen, CreditCard, FileText, Target, Tag, BarChart3, Building2, UserCheck, User, Upload, PlayCircle } from "lucide-react";

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
    if (
      session?.user?.role !== "admin" ||
      session.user.accessType !== "trial" ||
      !trialEndsAt
    ) {
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

  const getNavigationItems = () => {
    if (userRole === "super_admin") {
      return [
        {
          path: "/admin/profile",
          label: "Profile",
          icon: User,
        },
        {
          path: "/admin/manage-admins",
          label: "Manage Admins",
          icon: UserCog,
        },
        {
          path: "/admin/organization-names",
          label: "Organization Names",
          icon: Building2,
        },
        {
          path: "/admin/log-reports",
          label: "Log Reports",
          icon: FileText,
        },
      ];
    } else {
      return [
         {
          path: "/admin/profile",
          label: "Profile",
          icon: User,
        },
        {
          path: "/dashboard",
          label: "Dashboard Home",
          icon: Home,
        },
        {
          path: "/contacts",
          label: "Financial Module",
          icon: Users,
        },
        {
          path: "/admin/campaigns",
          label: "Manage Campaigns",
          icon: Target,
        },
        {
          path: "/admin/users",
          label: "Manage Users",
          icon: UserCog,
        },
        {
          path: "/admin/merge-contacts",
          label: "Merge Contacts",
          icon: Users,
        },
        {
          path: "/admin/categories",
          label: "Manage Categories",
          icon: FolderOpen,
        },
        {
          path: "/admin/payment-methods",
          label: "Payment Methods",
          icon: CreditCard,
        },
        {
          path: "/admin/tags",
          label: "Manage Tags",
          icon: Tag,
        },
        {
          path: "/admin/reports",
          label: "Reports",
          icon: BarChart3,
        },
        {
          path: "/admin/accounts",
          label: "Accounts",
          icon: Building2,
        },
        {
          path: "/admin/solicitors",
          label: "Solicitors",
          icon: UserCheck,
        },
        {
          path: "/admin/manual-donations/upload",
          label: "Manual Donation Upload",
          icon: Upload,
        },
        {
          path: "/admin/manage-subscription",
          label: "Manage Subscription",
          icon: CreditCard,
        },
        {
          path: "/admin/log-reports",
          label: "Audit Log",
          icon: FileText,
        },
      ];
    }
  };


  const navigationItems = getNavigationItems();

  return (
    /* Flat sidebar — no card wrapper, no rounded corners, no shadow.
       Just a single right border between rail and main content. Width 224px
       (w-56). Outer aside owns `overflow-hidden` so only the inner <nav>
       scrolls — eliminates the dual-scrollbar issue. */
    <aside className="flex h-full w-56 flex-col overflow-hidden border-r bg-background">
      {/* Logo block — slim. h-12 keeps it proportionate to the rail. */}
      <div className="flex shrink-0 items-center justify-center px-4 pt-5 pb-4">
        <img
          src="https://storage.googleapis.com/msgsndr/0lb5xbd0qHmaEqPUPc2N/media/f179ef7a-75f3-4c56-9fdd-85bc428972fb.png"
          alt="Company Logo"
          className="h-12 w-auto"
        />
      </div>

      {/* Section heading. text-xs uppercase reads as a label, not a title —
         standard pattern in dashboards (Linear, Vercel, GitHub admin). */}
      <div className="shrink-0 px-4 pb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {userRole === "super_admin" ? "Super Admin" : "Admin"}
        </h2>
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

      {/* Scrollable nav. min-w-0 + truncate on the label means long labels
         like "Manual Donation Upload" won't force horizontal overflow.
         no-scrollbar hides the gutter; users can still wheel-scroll. */}
      <nav className="no-scrollbar flex-1 min-h-0 space-y-0.5 overflow-y-auto px-2">
        {navigationItems.map((item) => (
          <Button
            key={item.path}
            variant={isActive(item.path) ? "default" : "ghost"}
            size="sm"
            className={`h-9 w-full min-w-0 justify-start px-2.5 text-sm font-medium ${
              isActive(item.path) ? "text-white" : "text-foreground/80"
            }`}
            asChild
          >
            <Link href={item.path} title={item.label}>
              <item.icon className="mr-2 h-4 w-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </Link>
          </Button>
        ))}
      </nav>

      {/* Footer pinned to bottom. Both rows are ghost-styled to match the
         nav items above — clean, unobtrusive, and ~50px shorter than the
         old green Onboarding box. The active state on Watch Course matches
         the rest of the nav so it visually fits the family. */}
      <div className="shrink-0 space-y-0.5 border-t px-2 py-2">
        <Button
          variant={isActive("/admin/onboarding") ? "default" : "ghost"}
          size="sm"
          className={`h-9 w-full min-w-0 justify-start px-2.5 text-sm font-medium ${
            isActive("/admin/onboarding") ? "text-white" : "text-foreground/80"
          }`}
          asChild
        >
          <Link href="/admin/onboarding" title="Watch Course">
            <PlayCircle className="mr-2 h-4 w-4 shrink-0" />
            <span className="truncate">Watch Course</span>
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 w-full min-w-0 justify-start px-2.5 text-sm font-medium text-foreground/80"
          onClick={handleSignOut}
        >
          <LogOut className="mr-2 h-4 w-4 shrink-0" />
          <span className="truncate">Sign Out</span>
        </Button>
      </div>
    </aside>
  );
}
