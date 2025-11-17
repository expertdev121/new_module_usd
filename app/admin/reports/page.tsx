"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, TrendingUp, Users, DollarSign, Calendar, Target } from "lucide-react";

export default function ReportsPage() {
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

  const reportSections = [
    {
      title: "Donor Contribution Reports",
      description: "Track giving levels and donor engagement",
      icon: Users,
      href: "/admin/reports/donor-contribution",
      color: "text-blue-600",
      subReports: [
        "Donor Contribution Reports ($500 and Above)",
        "Donor Contribution Reports ($1,000 and Above)",
        "Donor Contribution Reports (All Amounts)"
      ]
    },
    {
      title: "Campaign & Fundraising Reports",
      description: "Track fundraising effectiveness for campaigns and events",
      icon: Target,
      href: "/admin/reports/campaign-fundraising",
      color: "text-green-600",
      subReports: [
        "Event-Specific Fundraising Report"
      ]
    },
    {
      title: "Donor Segmentation Reports",
      description: "Identify and segment donors for targeted outreach",
      icon: TrendingUp,
      href: "/admin/reports/donor-segmentation",
      color: "text-purple-600",
      subReports: [
        "High-Level Giving by Event"
      ]
    },
    {
      title: "Financial & Accounting Reports",
      description: "Provide a clear breakdown of donations by level, event, and time period",
      icon: DollarSign,
      href: "/admin/reports/financial-accounting",
      color: "text-orange-600",
      subReports: [
        "Event-Based Year-End Giving Report"
      ]
    },
    {
      title: "LYBUNT & SYBUNT Reports",
      description: "Track donors who gave last year but not this year, and donors who gave in the past but not this year",
      icon: Calendar,
      href: "/admin/reports/lybunt-sybunt",
      color: "text-red-600",
      subReports: [
        "LYBUNT Reports",
        "SYBUNT Reports"
      ]
    },
    {
      title: "Outstanding Pledges Reports",
      description: "View pledges with outstanding balances, showing amount pledged, amount paid, and amount remaining",
      icon: FileText,
      href: "/admin/reports/outstanding-pledges",
      color: "text-purple-600",
      subReports: [
        "Outstanding Pledges Report"
      ]
    },
    {
      title: "Upcoming Expected Payments Reports",
      description: "View expected payments for pledges with outstanding balances where previous payments were made by card",
      icon: Calendar,
      href: "/admin/reports/upcoming-expected-payments",
      color: "text-blue-600",
      subReports: [
        "Upcoming Expected Payments Report"
      ]
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Reports Dashboard</h1>
        <p className="text-muted-foreground">
          Generate and view various donor and financial reports
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {reportSections.map((section) => (
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
              <div className="space-y-2">
                {section.subReports.map((subReport, index) => (
                  <div key={index} className="text-sm text-muted-foreground">
                    • {subReport}
                  </div>
                ))}
                <Button
                  className="w-full mt-4"
                  onClick={() => router.push(section.href)}
                >
                  Access {section.title}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
