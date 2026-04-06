"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import ContactsTable from "@/components/contacts/contacts-table";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { getOrganizationNameByLocationId } from "@/lib/location-org-name";

export default function ContactsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return; // Still loading
    if (!session) {
    }
  }, [session, status]);

  if (status === "loading") {
    return <div className="text-center py-8">Loading...</div>;
  }

  if (!session) {
    return (
      <main className="container mx-auto py-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Contacts</h1>
          <p className="mb-4">You need to be logged in to view contacts.</p>
          <Button onClick={() => router.push("/auth/login")}>
            Login
          </Button>
        </div>
      </main>
    );
  }

  const isAdmin = session.user.role === "admin";
  const organizationName = getOrganizationNameByLocationId(session.user.locationId);

  const handleSignOut = async () => {
    await signOut({ callbackUrl: "/" });
  };

  return (
    <div className="bg-gray-50">
      {isAdmin ? (
        <div className="flex h-screen">
          {/* <Sidebar /> */}
          <main className="flex-1 p-8 overflow-y-auto">
            <div className="flex justify-between items-start mb-6">
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-bold">Contacts</h1>
                <span className="inline-flex items-center rounded-full border bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
                  {organizationName}
                </span>
              </div>
            </div>
            <Suspense
              fallback={<div className="text-center py-8">Loading contacts...</div>}
            >
              <ContactsTable isAdmin={isAdmin} />
            </Suspense>
          </main>
        </div>
      ) : (
        <div className="max-w-7xl">
          <div className="flex justify-between items-start mb-6">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold">Contacts</h1>
              <span className="inline-flex items-center rounded-full border bg-muted px-3 py-1 text-sm font-medium text-muted-foreground">
                {organizationName}
              </span>
            </div>
            <Button
              variant="outline"
              onClick={handleSignOut}
              className="flex items-center space-x-2"
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </Button>
          </div>
          <Suspense
            fallback={<div className="text-center py-8">Loading contacts...</div>}
          >
            <ContactsTable isAdmin={isAdmin} />
          </Suspense>
        </div>
      )}
    </div>
  );
}
