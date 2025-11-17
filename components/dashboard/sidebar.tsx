"use client";
import { signOut, useSession } from "next-auth/react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LogOut, Users, Home, UserPlus, UserCog, FolderOpen, CreditCard, FileText, Target, Tag, BarChart3, Building2, UserCheck } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = session?.user?.role;

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/auth/login" });
  };

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
          path: "/admin/manage-admins",
          label: "Manage Admins",
          icon: UserCog,
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
          path: "/dashboard",
          label: "Dashboard Home",
          icon: Home,
        },
        {
          path: "/contacts",
          label: "Financial module",
          icon: Users,
        },
        {
          path: "/admin/campaigns",
          label: "Manage Campaigns",
          icon: Target,
        },
        {
          path: "/admin/add-user",
          label: "Add User",
          icon: UserPlus,
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
      ];
    }
  };

  const navigationItems = getNavigationItems();

  return (
    <Card className="w-64 h-full p-4">
      <div className="space-y-4">
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
        <nav className="space-y-2">
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
        <div className="pt-4 border-t">
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
