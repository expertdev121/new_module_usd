"use client";

/**
 * Sidebar (redesign) — a self-contained recreation of the reference layout,
 * built on the DonorHQ stack: Next.js + Tailwind + lucide-react.
 *
 * Behaviour:
 *   • desktop (≥1024px) — full 288px rail, with a manual collapse toggle
 *   • tablet  (768–1023px) — auto-collapses to a 76px icon rail
 *   • mobile  (<768px) — off-canvas drawer + dimmed overlay (hamburger)
 *
 * Accessibility: semantic <nav><ul><li>, aria-current on the active link,
 * aria-expanded/aria-controls on the Setup group and hamburger, visible
 * focus rings, roving Arrow-key navigation, prefers-reduced-motion safe.
 *
 * The nav data is a plain array — swap `NAV` / labels / routes to wire it to
 * real pages. Left standalone (not mounted) so it doesn't disturb the live
 * sidebar until you choose to adopt it.
 */
import { useEffect, useRef, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import {
  Home, Users, CreditCard, FileText, Target, ClipboardList, BarChart3,
  SlidersHorizontal, ChevronDown, LogOut, Search, Menu, PanelLeft, type LucideIcon,
} from "lucide-react";

type Badge = { text: string; tone: "green" | "amber" | "neutral" };
type NavItem = { id: string; label: string; icon: LucideIcon; badge?: Badge };

const NAV: NavItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "donors", label: "Donors", icon: Users, badge: { text: "4.8k", tone: "green" } },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "pledges", label: "Pledges", icon: FileText, badge: { text: "6", tone: "amber" } },
  { id: "campaigns", label: "Campaigns", icon: Target },
  { id: "forms", label: "Donation forms", icon: ClipboardList },
  { id: "insights", label: "Insights", icon: BarChart3 },
];

const SETUP_SUB = ["General", "Team & roles", "Billing", "Integrations"];

const badgeTone: Record<Badge["tone"], string> = {
  green: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  neutral: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

export function SidebarRedesign() {
  const [isMobile, setIsMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [active, setActive] = useState("donors");
  const manual = useRef(false); // user has taken over the collapse control
  const navRef = useRef<HTMLElement>(null);

  // Responsive mode: mobile drawer / auto tablet rail / desktop.
  useEffect(() => {
    const mob = window.matchMedia("(max-width: 767px)");
    const tab = window.matchMedia("(min-width: 768px) and (max-width: 1023px)");
    const apply = () => {
      setIsMobile(mob.matches);
      if (!manual.current) setCollapsed(tab.matches);
      if (!mob.matches) setMobileOpen(false);
    };
    apply();
    mob.addEventListener("change", apply);
    tab.addEventListener("change", apply);
    return () => { mob.removeEventListener("change", apply); tab.removeEventListener("change", apply); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const showLabels = isMobile ? true : !collapsed;

  // Roving Arrow-key focus across the visible nav rows.
  const onNavKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = Array.from(navRef.current?.querySelectorAll<HTMLElement>("[data-nav-row]") ?? [])
      .filter((el) => el.offsetParent !== null);
    const i = rows.indexOf(document.activeElement as HTMLElement);
    if (i === -1) return;
    e.preventDefault();
    const next = e.key === "ArrowDown" ? (i + 1) % rows.length : (i - 1 + rows.length) % rows.length;
    rows[next].focus();
  };

  const rowBase =
    "flex w-full items-center gap-3 rounded-lg px-3 py-[9px] text-sm font-medium text-zinc-500 " +
    "transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none " +
    "focus-visible:ring-2 focus-visible:ring-green-500/40 dark:text-zinc-400 dark:hover:bg-zinc-800 " +
    "dark:hover:text-zinc-100";
  const rowRail = "justify-center px-0";

  const IconBtn = ({ icon: Icon, label, onClick, className }: { icon: ComponentType<{ className?: string }>; label: string; onClick?: () => void; className?: string }) => (
    <button
      type="button" onClick={onClick} aria-label={label} title={label}
      className={cn(
        "grid h-8 w-8 shrink-0 place-items-center rounded-lg text-zinc-500 transition-colors",
        "hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2",
        "focus-visible:ring-green-500/40 dark:text-zinc-400 dark:hover:bg-zinc-800",
        className,
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );

  return (
    <>
      {/* Mobile trigger */}
      {isMobile && (
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu" aria-controls="app-sidebar" aria-expanded={mobileOpen}
          className="fixed left-3.5 top-3.5 z-[60] grid h-10 w-10 place-items-center rounded-[10px] border border-zinc-200 bg-white text-zinc-900 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <Menu className="h-5 w-5" />
        </button>
      )}

      {/* Mobile overlay */}
      {isMobile && (
        <div
          onClick={() => setMobileOpen(false)}
          className={cn(
            "fixed inset-0 z-40 bg-zinc-950/45 transition-opacity duration-200",
            mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
          )}
          aria-hidden="true"
        />
      )}

      <aside
        id="app-sidebar"
        data-sidebar-redesign
        aria-label="Primary"
        className={cn(
          "flex h-[100dvh] flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900",
          isMobile
            ? cn(
                "fixed inset-y-0 left-0 z-50 w-72 shadow-2xl transition-transform duration-200 motion-reduce:transition-none",
                mobileOpen ? "translate-x-0" : "-translate-x-full",
              )
            : cn("sticky top-0 shrink-0 transition-[width] duration-200 motion-reduce:transition-none", collapsed ? "w-[76px]" : "w-72"),
        )}
      >
        {/* Header — workspace switcher + collapse control + search */}
        <div className={cn("flex flex-col gap-3 px-3 pb-3 pt-4", !showLabels && "items-center")}>
          <div className={cn("flex items-center gap-1.5", !showLabels && "flex-col gap-2")}>
            <button
              type="button"
              aria-label="Switch workspace"
              className={cn(
                "flex min-w-0 flex-1 items-center gap-3 rounded-[10px] p-1.5 text-left transition-colors",
                "hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40 dark:hover:bg-zinc-800",
                !showLabels && "flex-none justify-center",
              )}
            >
              <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-green-500 to-green-700 text-sm font-bold tracking-wide text-white shadow-[inset_0_1px_0_rgba(255,255,255,.25)]">
                DH
              </span>
              {showLabels && (
                <>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-[15px] font-semibold leading-tight tracking-tight text-zinc-900 dark:text-zinc-100">DonorHQ</span>
                    <span className="truncate text-[12.5px] leading-snug text-zinc-500 dark:text-zinc-400">Lev HaTorah</span>
                  </span>
                  <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-zinc-400" />
                </>
              )}
            </button>
            <IconBtn
              icon={PanelLeft}
              label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={() => { manual.current = true; setCollapsed((c) => !c); }}
            />
          </div>

          {/* Search */}
          <div className="relative flex w-full items-center" role="search">
            <Search className="pointer-events-none absolute left-3 h-[18px] w-[18px] text-zinc-400" />
            {showLabels ? (
              <>
                <input
                  type="text" placeholder="Search" aria-label="Search"
                  className="h-10 w-full rounded-[10px] border border-transparent bg-zinc-100 pl-9 pr-14 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-400 focus-visible:border-green-500 focus-visible:bg-white focus-visible:ring-[3px] focus-visible:ring-green-500/25 dark:bg-zinc-800 dark:text-zinc-100 dark:focus-visible:bg-zinc-900"
                />
                <kbd className="pointer-events-none absolute right-2.5 inline-flex h-5 items-center rounded-md border border-zinc-200 bg-white px-1.5 text-[11px] font-semibold text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900">⌘K</kbd>
              </>
            ) : (
              <button type="button" aria-label="Search" title="Search" className="grid h-10 w-10 place-items-center rounded-[10px] bg-zinc-100 text-zinc-400 hover:text-zinc-900 dark:bg-zinc-800">
                <Search className="h-[18px] w-[18px]" />
              </button>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav ref={navRef} onKeyDown={onNavKeyDown} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-1">
          <ul className="flex flex-col gap-0.5">
            {NAV.map((item) => {
              const isActive = active === item.id;
              return (
                <li key={item.id}>
                  <a
                    href="#" data-nav-row title={item.label}
                    aria-current={isActive ? "page" : undefined}
                    onClick={(e) => { e.preventDefault(); setActive(item.id); if (isMobile) setMobileOpen(false); }}
                    className={cn(
                      rowBase,
                      !showLabels && rowRail,
                      isActive && "bg-green-50 font-semibold text-green-700 hover:bg-green-50 hover:text-green-700 dark:bg-green-950/40 dark:text-green-400 dark:hover:bg-green-950/40",
                    )}
                  >
                    <item.icon className={cn("h-5 w-5 shrink-0", isActive ? "text-green-600 dark:text-green-400" : "opacity-90")} />
                    {showLabels && (
                      <>
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.badge && (
                          <span className={cn("ml-auto inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-semibold tabular-nums", badgeTone[item.badge.tone])}>
                            {item.badge.text}
                          </span>
                        )}
                      </>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>

          {/* Collapsible Setup group */}
          <ul className="mt-2 flex flex-col gap-0.5 border-t border-zinc-200 pt-2 dark:border-zinc-800">
            <li>
              <button
                type="button" data-nav-row title="Setup"
                aria-expanded={setupOpen} aria-controls="setup-sub"
                onClick={() => setSetupOpen((o) => !o)}
                className={cn(rowBase, !showLabels && rowRail)}
              >
                <SlidersHorizontal className="h-5 w-5 shrink-0 opacity-90" />
                {showLabels && (
                  <>
                    <span className="flex-1 truncate text-left">Setup</span>
                    <ChevronDown className={cn("ml-auto h-4 w-4 text-zinc-400 transition-transform", setupOpen && "rotate-180")} />
                  </>
                )}
              </button>
              {showLabels && setupOpen && (
                <ul id="setup-sub" className="mt-0.5 flex flex-col gap-0.5">
                  {SETUP_SUB.map((s) => (
                    <li key={s}>
                      <a href="#" data-nav-row onClick={(e) => e.preventDefault()} className={cn(rowBase, "py-[7px] pl-[46px] text-[13.5px]")}>
                        <span className="flex-1 truncate">{s}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          </ul>
        </nav>

        {/* Footer — signed-in user */}
        <div className={cn("mx-1 flex shrink-0 items-center gap-3 border-t border-zinc-200 p-3 dark:border-zinc-800", !showLabels && "justify-center")}>
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-zinc-200 bg-zinc-100 text-[12.5px] font-bold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">RS</span>
          {showLabels && (
            <>
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-semibold leading-tight text-zinc-900 dark:text-zinc-100">Rabbi Shlomo</span>
                <span className="text-xs leading-tight text-zinc-500 dark:text-zinc-400">Admin</span>
              </span>
              <IconBtn icon={LogOut} label="Sign out" className="ml-auto hover:!bg-red-50 hover:!text-red-600 dark:hover:!bg-red-950/40" />
            </>
          )}
        </div>
      </aside>
    </>
  );
}

export default SidebarRedesign;
