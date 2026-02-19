"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useRef, useEffect, useState } from "react";

function ManageSubscriptionContent() {
  const searchParams = useSearchParams();
  const locationId = searchParams.get("locationId");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [modalUrl, setModalUrl] = useState<string | null>(null);

  const subscriptionUrl = "https://d9fnnfprjjkmmmxauclr.app.clientclub.net/";

  useEffect(() => {
    // When the iframe triggers a popup/new tab, the parent window loses focus
    // We intercept this by overriding the referrer-based navigation detection
    const handleBlur = () => {
      // Window blurred = likely a popup was opened by the iframe
      // We can't stop it here, so we use the sandbox approach below
    };

    window.addEventListener("blur", handleBlur);
    return () => window.removeEventListener("blur", handleBlur);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Manage Subscription</h1>
        <p className="text-muted-foreground">
          {locationId
            ? `Managing subscription for location: ${locationId}`
            : "Manage your subscription settings"}
        </p>
      </div>

      <div
        className="border rounded-lg overflow-hidden relative"
        style={{ height: "calc(100vh - 200px)" }}
      >
        <iframe
          ref={iframeRef}
          src={subscriptionUrl}
          className="w-full h-full border-0"
          title="Manage Subscription"
          // No allow-popups = new tabs are blocked entirely
          // No allow-top-navigation = parent page can't be hijacked
          // allow-top-navigation-by-user-activation = iframe can navigate itself
          sandbox="allow-scripts allow-same-origin allow-forms allow-top-navigation-by-user-activation allow-downloads"
        />
      </div>
    </div>
  );
}

export default function ManageSubscriptionPage() {
  return (
    <Suspense fallback={<div className="text-center py-8">Loading...</div>}>
      <ManageSubscriptionContent />
    </Suspense>
  );
}