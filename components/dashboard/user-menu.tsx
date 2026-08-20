"use client";

/**
 * Top-bar account menu — a rounded avatar (initials) that opens a dropdown
 * with the signed-in identity, a link to Profile settings (change email /
 * password), and Sign out. Replaces the old sidebar "Profile" link.
 */
import Link from "next/link";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { ArrowLeftRight, ChevronDown, LogOut, Settings, Undo2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AccountSwitcherDialog, useAccountSwitch } from "./account-switcher";

/** Two-letter initials from a display name, falling back to the email. */
function initialsFrom(name?: string | null, email?: string | null): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
  }
  const local = (email ?? "").split("@")[0];
  const alpha = local.replace(/[^a-zA-Z]/g, "");
  return (alpha.slice(0, 2) || local.slice(0, 2) || "U").toUpperCase();
}

export function UserMenu() {
  const { data: session } = useSession();
  const { returnToSuper, busy } = useAccountSwitch();
  const [switcherOpen, setSwitcherOpen] = useState(false);
  if (!session?.user) return null;

  const email = session.user.email ?? "";
  const name = session.user.name ?? null;
  const displayName = name || email.split("@")[0] || "Account";
  const initials = initialsFrom(name, email);
  // The super admin's TRUE role (preserved while impersonating).
  const realRole = session.user.realRole ?? session.user.role;
  const isSuperAdmin = realRole === "super_admin";
  const impersonating = Boolean(session.user.impersonating);
  const role = isSuperAdmin ? "Super Admin" : realRole === "admin" ? "Admin" : "User";

  return (
    <>
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Open account menu"
          className="group flex items-center gap-2 rounded-full py-1 pl-1 pr-2 transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white shadow-sm ring-2 ring-background">
            {initials}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={8} className="w-60">
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-3 px-2 py-2.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-sm font-semibold text-white">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
              <p className="truncate text-xs text-muted-foreground">{email}</p>
              <span className="mt-1 inline-flex rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {role}
              </span>
              {impersonating && (
                <p className="mt-1 truncate text-[11px] font-medium text-amber-700">
                  Viewing {session.user.impersonatedOrgName || session.user.locationId}
                </p>
              )}
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild className="cursor-pointer">
          <Link href="/admin/profile">
            <Settings className="mr-2 h-4 w-4" />
            Profile settings
          </Link>
        </DropdownMenuItem>

        {/* Account switching — super admins only. */}
        {isSuperAdmin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="cursor-pointer"
              onSelect={(e) => {
                e.preventDefault();
                setSwitcherOpen(true);
              }}
            >
              <ArrowLeftRight className="mr-2 h-4 w-4" />
              Switch account
            </DropdownMenuItem>
            {impersonating && (
              <DropdownMenuItem
                className="cursor-pointer text-amber-700 focus:text-amber-700"
                disabled={busy}
                onSelect={(e) => {
                  e.preventDefault();
                  void returnToSuper();
                }}
              >
                <Undo2 className="mr-2 h-4 w-4" />
                Return to super admin
              </DropdownMenuItem>
            )}
          </>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="cursor-pointer text-red-600 focus:text-red-600"
          onClick={() => void signOut({ callbackUrl: "/auth/login" })}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    {isSuperAdmin && (
      <AccountSwitcherDialog open={switcherOpen} onOpenChange={setSwitcherOpen} />
    )}
    </>
  );
}
