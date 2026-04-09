"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [open, setOpen] = useState(false);

  const shouldBlockAccess = useMemo(() => {
    if (status !== "authenticated" || !session?.user) {
      return false;
    }

    return (
      session.user.role === "admin" &&
      session.user.accessType === "trial" &&
      session.user.trialExpired
    );
  }, [session, status]);

  useEffect(() => {
    if (!shouldBlockAccess) {
      setOpen(false);
      return;
    }

    setOpen(true);

    const timeoutId = window.setTimeout(() => {
      void signOut({
        callbackUrl:
          "/auth/login?trial=expired&message=" +
          encodeURIComponent("Your free trial has ended."),
      });
    }, 2000);

    return () => window.clearTimeout(timeoutId);
  }, [shouldBlockAccess]);

  return (
    <Dialog open={open}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Free Trial Ended</DialogTitle>
          <DialogDescription>
            Your free trial has ended. You&apos;ll be logged out now. Please
            contact your super admin to restore access.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            onClick={() =>
              signOut({
                callbackUrl:
                  "/auth/login?trial=expired&message=" +
                  encodeURIComponent("Your free trial has ended."),
              })
            }
          >
            Return to login
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
