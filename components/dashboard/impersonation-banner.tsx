"use client";

/**
 * Sticky banner shown ONLY while a super admin is impersonating a client
 * account. Makes the switched state obvious and offers a one-click return.
 */
import { useSession } from "next-auth/react";
import { Loader2, LogOut, ShieldAlert } from "lucide-react";
import { useAccountSwitch } from "./account-switcher";

export function ImpersonationBanner() {
  const { data: session } = useSession();
  const { returnToSuper, busy } = useAccountSwitch();

  if (!session?.user?.impersonating) return null;

  const org = session.user.impersonatedOrgName || session.user.locationId || "this account";

  return (
    <div className="sticky top-14 z-40 flex flex-wrap items-center justify-between gap-2 border-b border-amber-300 bg-amber-100 px-4 py-2 text-amber-900 sm:px-5 dark:border-amber-500/40 dark:bg-amber-950/60 dark:text-amber-200">
      <span className="flex items-center gap-2 text-sm">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          Viewing <strong>{org}</strong> as super admin.
        </span>
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={() => void returnToSuper()}
        className="inline-flex items-center gap-1.5 rounded-md bg-amber-900 px-2.5 py-1 text-xs font-medium text-amber-50 transition-colors hover:bg-amber-800 disabled:opacity-60 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
        Return to your account
      </button>
    </div>
  );
}
