"use client";

import { SessionProvider } from "next-auth/react";
import { TanstackQueryProvider } from "@/app/query-provider";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "@/components/ui/sonner";
import { TrialAccessGuard } from "@/components/trial-access-guard";

export function Providers({ children }: { children: React.ReactNode }) {
  // refetchOnWindowFocus is disabled: NextAuth's default re-fetches the session
  // every time the tab regains focus, which re-rendered the whole app and
  // discarded in-progress form entry when users switched tabs (GS-3 / GS-21).
  // Session still updates on explicit update() calls.
  return (
    <SessionProvider refetchOnWindowFocus={false}>
      <TanstackQueryProvider>
        <NuqsAdapter>
          <TrialAccessGuard />
          {children}
          <Toaster position="top-center" />
        </NuqsAdapter>
      </TanstackQueryProvider>
    </SessionProvider>
  );
}
