"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Users, CreditCard, Tag, UserPlus, Settings, FileText, Building2 } from "lucide-react";

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
    } else if (session.user.role !== "admin") {
      router.push("/contacts");
    }
  }, [session, status, router]);

  if (status === "loading") {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!session || session.user.role !== "admin") {
    return null; // Will redirect
  }

  const adminSections = [
    {
      title: "User Management",
      description: "Manage user accounts and permissions",
      icon: Users,
      href: "/admin/users",
      color: "text-blue-600",
    },
    {
      title: "Add User",
      description: "Create new user accounts",
      icon: UserPlus,
      href: "/admin/add-user",
      color: "text-green-600",
    },
    {
      title: "Payment Methods",
      description: "Configure payment methods and details",
      icon: CreditCard,
      href: "/admin/payment-methods",
      color: "text-orange-600",
    },
    {
      title: "Accounts",
      description: "Manage accounts for donations",
      icon: Building2,
      href: "/admin/accounts",
      color: "text-purple-600",
    },
    {
      title: "Categories",
      description: "Manage categories, items, and groups",
      icon: Tag,
      href: "/admin/categories",
      color: "text-red-600",
    },
    {
      title: "Campaigns",
      description: "Manage campaigns and pledges",
      icon: FileText,
      href: "/admin/campaigns",
      color: "text-indigo-600",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground">
          Manage your application settings and data
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {adminSections.map((section) => (
          <Card key={section.href} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-center gap-3">
                <section.icon className={`h-8 w-8 ${section.color}`} />
                <div>
                  <CardTitle className="text-lg">{section.title}</CardTitle>
                  <CardDescription>{section.description}</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Button
                className="w-full"
                onClick={() => router.push(section.href)}
              >
                Access {section.title}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
