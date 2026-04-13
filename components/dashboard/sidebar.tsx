"use client";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LogOut, Users, Home, UserPlus, UserCog, FolderOpen, CreditCard, FileText, Target, Tag, BarChart3, Building2, UserCheck, CreditCardIcon, User } from "lucide-react";

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
  <Card className="w-64 h-full p-4 flex flex-col">
    <div className="flex flex-col flex-1 min-h-0 space-y-4">
      <div className="flex items-center justify-center mb-4">
        <img
          src="https://storage.googleapis.com/msgsndr/0lb5xbd0qHmaEqPUPc2N/media/f179ef7a-75f3-4c56-9fdd-85bc428972fb.png"
          alt="Company Logo"
          className="h-20 w-auto"
        />
      </div>
      <h2 className="text-lg font-semibold">
        {userRole === "super_admin" ? "Super Admin Dashboard" : "Admin Dashboard"}
      </h2>
      {trialTimer && (
        <div className="rounded-lg border bg-amber-50 p-3 text-sm text-amber-950">
          <div className="font-semibold">Free Trial</div>
          <div className="mt-1">
            {trialTimer.expired ? "Expired" : `${trialTimer.label} remaining`}
          </div>
          <div className="mt-1 text-xs text-amber-800">
            Expires on {trialTimer.endsAtLabel}
          </div>
        </div>
      )}
      <nav className="space-y-2 flex-1 overflow-y-auto">
        {navigationItems.map((item) => (
          <Button
            key={item.path}
            variant={isActive(item.path) ? "default" : "ghost"}
            className={`w-full justify-start ${isActive(item.path) ? "text-white" : "text-gray-800"}`}
            asChild
          >
            <Link href={item.path}>
              <item.icon className="mr-2 h-4 w-4" />
              {item.label}
            </Link>
          </Button>
        ))}
      </nav>
      <div className="pt-4 border-t mt-auto shrink-0">
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={handleSignOut}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign Out
        </Button>
      </div>
    </div>
  </Card>
);
}
