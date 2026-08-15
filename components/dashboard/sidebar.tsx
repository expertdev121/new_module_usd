"use client";
import { useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Users, Home, UserCog, FolderOpen, CreditCard, FileText, Target, Tag, BarChart3, Building2, UserCheck, Upload, Plug, Activity, UserMinus, HandCoins, Megaphone, Users2, Banknote, ChevronDown, type LucideIcon } from "lucide-react";

type NavItem = { path: string; label: string; icon: LucideIcon };
type NavGroup = { title: string | null; items: NavItem[]; collapsible?: boolean };

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const userRole = session?.user?.role;
  const trialEndsAt = session?.user?.trialEndsAt;
  const [now, setNow] = useState(Date.now());
  const [orgName, setOrgName] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(true);
  // Per-tenant account_type — controls whether the "Households" nav
  // item is visible. Undefined until the API resolves; missing/error
  // falls back to "individual" so the sidebar never shows a stray
  // Households link to a tenant that hasn't opted in.
  const [accountType, setAccountType] = useState<
    "individual" | "household" | undefined
  >(undefined);
  useEffect(() => {
    if (!session?.user) return;
    if (session.user.role !== "admin" && session.user.role !== "super_admin") return;
    let cancelled = false;
    fetch("/api/admin/location-settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { accountType: "individual" }))
      .then((b) => { if (!cancelled) setAccountType(b.accountType ?? "individual"); })
      .catch(() => { if (!cancelled) setAccountType("individual"); });
    return () => { cancelled = true; };
  }, [session]);

  // Org name for the workspace switcher — same source the Contacts page uses.
  useEffect(() => {
    if (!session?.user?.locationId) { setOrgName(null); return; }
    let cancelled = false;
    fetch("/api/organization-name")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => { if (!cancelled && b) setOrgName(b.orgName || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [session?.user?.locationId]);

  useEffect(() => {
    // Show the countdown to every logged-in user of a trial account,
    // not just the admin. Regular users of the tenant deserve the same
    // heads-up about when access is locking down.
    if (session?.user?.accessType !== "trial" || !trialEndsAt) {
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

  /* Navigation is grouped — uppercase section labels separate workspace
     items, things you manage, and account-level controls. Super admin
     stays as a single ungrouped list because it only has 4 items. */
  const getNavigationGroups = (): NavGroup[] => {
    if (userRole === "super_admin") {
      return [
        {
          title: null,
          items: [
            { path: "/admin/manage-admins", label: "Manage Admins", icon: UserCog },
            { path: "/admin/organization-names", label: "Organization Names", icon: Building2 },
            { path: "/admin/log-reports", label: "Log Reports", icon: FileText },
            { path: "/admin/ghl-webhook-logs", label: "GHL Webhook Logs", icon: Activity },
            { path: "/admin/offboard-clients", label: "Offboard Clients", icon: UserMinus },
          ],
        },
      ];
    }
    return [
      {
        title: "Workspace",
        items: [
          { path: "/dashboard", label: "Dashboard Home", icon: Home },
          { path: "/contacts", label: "Financial Module", icon: Users },
          { path: "/donations", label: "Donations", icon: Banknote },
          { path: "/admin/reports", label: "Reports", icon: BarChart3 },
        ],
      },
      {
        title: "Manage",
        items: [
          { path: "/admin/campaigns", label: "Manage Campaigns", icon: Target },
          { path: "/admin/users", label: "Manage Users", icon: UserCog },
          { path: "/admin/merge-contacts", label: "Merge Contacts", icon: Users },
          // Household mode is opt-in per tenant. Everyone else never sees this row.
          ...(accountType === "household"
            ? [{ path: "/admin/households", label: "Households", icon: Users2 }]
            : []),
          { path: "/admin/categories", label: "Manage Categories", icon: FolderOpen },
          { path: "/admin/payment-methods", label: "Payment Methods", icon: CreditCard },
          { path: "/admin/tags", label: "Manage Tags", icon: Tag },
          { path: "/admin/solicitors", label: "Solicitors", icon: UserCheck },
          { path: "/admin/accounts", label: "Accounts", icon: Building2 },
          { path: "/admin/manual-donations/upload", label: "Manual Donation Upload", icon: Upload },
        ],
      },
      {
        title: "Account",
        collapsible: true,
        items: [
          { path: "/admin/connections", label: "Connections", icon: Plug },
          { path: "/admin/crowded", label: "Donation Forms", icon: HandCoins },
          { path: "/admin/fundrazr", label: "FundRazr", icon: Megaphone },
          { path: "/admin/manage-subscription", label: "Manage Subscription", icon: CreditCard },
          { path: "/admin/log-reports", label: "Audit Log", icon: FileText },
        ],
      },
    ];
  };

  const navigationGroups = getNavigationGroups();

  /* Row styling (redesign): quiet ghost rows on the theme's neutral tokens,
     with a green pill for the active route — icon and label both go green.
     Green is the only accent; neutrals stay on the app's design tokens so
     the sidebar reads as part of the same system. */
  const navItemClass = (active: boolean) =>
    cn(
      "flex h-9 w-full min-w-0 items-center gap-3 rounded-lg px-3 text-sm transition-colors",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40",
      active
        ? "bg-green-50 font-semibold text-green-700 dark:bg-green-950/40 dark:text-green-400"
        : "font-medium text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    /* Professional sidebar — pure white card surface against the gray page,
       single right border, no shadow. The contrast comes from the
       background difference, not from chrome. */
    <aside className="flex h-full w-56 flex-col overflow-hidden border-r bg-card">
      {/* Workspace switcher — brand tile + org name, links home for the role. */}
      <div className="shrink-0 px-2 pt-3 pb-2">
        <Link
          href={userRole === "super_admin" ? "/admin/manage-admins" : "/dashboard"}
          className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-green-500 to-green-700 text-sm font-bold tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25)]">
            DH
          </span>
          <span className="flex min-w-0 flex-col">
            <span className="text-[15px] font-semibold leading-tight tracking-tight text-foreground">DonorHQ</span>
            <span className="truncate text-xs leading-snug text-muted-foreground">
              {userRole === "super_admin" ? "Super Admin" : orgName || "Workspace"}
            </span>
          </span>
        </Link>
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

      {/* Grouped scrollable nav. */}
      <nav className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {navigationGroups.map((group, groupIndex) => {
          const open = group.collapsible ? accountOpen : true;
          return (
            <div key={group.title ?? `group-${groupIndex}`} className={cn(groupIndex > 0 && "mt-4")}>
              {group.title &&
                (group.collapsible ? (
                  <button
                    type="button"
                    onClick={() => setAccountOpen((o) => !o)}
                    aria-expanded={open}
                    className="mb-1.5 flex w-full items-center px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 transition-colors hover:text-foreground"
                  >
                    <span>{group.title}</span>
                    <ChevronDown className={cn("ml-auto h-3.5 w-3.5 transition-transform", !open && "-rotate-90")} />
                  </button>
                ) : (
                  <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {group.title}
                  </p>
                ))}
              {open && (
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item.path);
                    return (
                      <Link
                        key={item.path}
                        href={item.path}
                        title={item.label}
                        aria-current={active ? "page" : undefined}
                        className={navItemClass(active)}
                      >
                        <item.icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-green-600 dark:text-green-400" : "opacity-90")} />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
