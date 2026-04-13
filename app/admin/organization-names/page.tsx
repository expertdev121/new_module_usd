"use client";

import { OrganizationNamesManagement } from "@/components/admin/organization-names-management";

export default function OrganizationNamesPage() {
  return (
    <div className="container mx-auto p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Organization Names</h1>
        <p className="text-muted-foreground">
          Manage one organization name per location ID.
        </p>
      </div>
      <OrganizationNamesManagement />
    </div>
  );
}
