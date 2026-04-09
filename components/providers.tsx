"use client";

import { SessionProvider } from "next-auth/react";
import { TanstackQueryProvider } from "@/app/query-provider";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "@/components/ui/sonner";
import { TrialAccessGuard } from "@/components/trial-access-guard";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
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
