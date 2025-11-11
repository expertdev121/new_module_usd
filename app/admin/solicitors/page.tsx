"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import SolicitorDashboard from "@/components/solicitor-dashboard";

export default function SolicitorsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
      return;
    }
    if (session.user.role !== "admin" && session.user.role !== "super_admin") {
      router.push("/dashboard");
      return;
    }
  }, [session, status, router]);

  if (status === "loading") {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!session || (session.user.role !== "admin" && session.user.role !== "super_admin")) {
    return null;
  }

  return (
    <div className="container mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Solicitors Management</h1>
        <p className="text-muted-foreground">
          Manage solicitors, view performance metrics, and handle assignments
        </p>
      </div>
      <SolicitorDashboard />
    </div>
  );
}
