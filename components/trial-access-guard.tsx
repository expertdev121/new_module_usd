"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function TrialAccessGuard() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(Date.now());

  const shouldBlockAccess = useMemo(() => {
    if (status !== "authenticated" || !session?.user) {
      return false;
    }

    return (
      session.user.role === "admin" &&
      session.user.accessType === "trial" &&
      session.user.accessLocked &&
      pathname !== "/admin/manage-subscription"
    );
  }, [pathname, session, status]);

  const graceCountdown = useMemo(() => {
    if (!session?.user?.graceEndsAt) return null;

    const remainingMs = Math.max(new Date(session.user.graceEndsAt).getTime() - now, 0);
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${days}d ${hours}h ${minutes}m ${seconds}s`;
  }, [now, session?.user?.graceEndsAt]);

  useEffect(() => {
    if (!shouldBlockAccess) {
      setOpen(false);
      return;
    }

    setOpen(true);
  }, [shouldBlockAccess]);

  useEffect(() => {
    if (!shouldBlockAccess) return;

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [shouldBlockAccess]);

  const handleUpgrade = () => {
    window.location.href =
      "https://app.givesuite.com/v2/preview/OmcbmxnJibm8i6lOARyK?notrack=true";
  };

  const handleLogout = () => {
    void signOut({ callbackUrl: "/auth/login" });
  };

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-xl"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Free Access Expired</DialogTitle>
          <DialogDescription>
            Your free access has expired. Upgrade within the next {session?.user?.graceDays ?? 7} days to keep your account active.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-lg border bg-muted/40 p-4">
          <div className="text-sm text-muted-foreground">Time left to upgrade</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">
            {graceCountdown ?? "0d 0h 0m 0s"}
          </div>
        </div>
        <div className="text-sm text-muted-foreground">
          You no longer have access to the app while your subscription is inactive. Upgrade to restore access, or log out.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={handleLogout}>
            Logout
          </Button>
          <Button onClick={handleUpgrade}>
            Upgrade
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
