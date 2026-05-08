"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, Suspense } from "react";
import ContactsTable from "@/components/contacts/contacts-table";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export default function ContactsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("Organization");

  useEffect(() => {
    if (!session?.user?.locationId) {
      setOrganizationName("Organization");
      return;
    }

    const loadOrganizationName = async () => {
      try {
        const response = await fetch("/api/organization-name");
        if (!response.ok) return;
        const result = await response.json();
        setOrganizationName(result.orgName || "Organization");
      } catch (error) {
        console.error("Failed to load organization name:", error);
      }
    };

    void loadOrganizationName();
  }, [session?.user?.locationId]);

  if (status === "loading") {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!session) {
    return (
      <div className="text-center">
        <h1 className="mb-4 text-2xl font-bold">Contacts</h1>
        <p className="mb-4">You need to be logged in to view contacts.</p>
        <Button onClick={() => router.push("/auth/login")}>Login</Button>
      </div>
    );
  }

  const isAdmin = session.user.role === "admin";

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/" });
  };

  /* Header is identical for both admin and non-admin — title with the org
     as a sub-line. The sub-line gives the org name a real role: it tells
     you whose data you're viewing without competing with the page title. */
  const Header = (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight">Contacts</h1>
        <p className="mt-1 text-sm text-muted-foreground">{organizationName}</p>
      </div>
      {!isAdmin && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleSignOut}
          className="flex items-center gap-2"
        >
          <LogOut className="h-4 w-4" />
          <span>Sign Out</span>
        </Button>
      )}
    </header>
  );

  /* No nested layout wrappers — the global layout-wrapper already provides
     h-screen, the scrolling main, and the page padding. Anything we wrap in
     here would create dual scrollbars and stacked padding. */
  return (
    <div>
      {Header}
      <Suspense fallback={<div className="py-8 text-center">Loading contacts...</div>}>
        <ContactsTable isAdmin={isAdmin} />
      </Suspense>
    </div>
  );
}
