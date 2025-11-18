"use client";

import React, { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, CreditCard, Lock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface PayrocConfig {
  merchantId: string;
  terminalId: string;
  apiKey: string;
  identityUrl: string;
  apiBaseUrl: string;
  hostedFieldsScript: string;
  libVersion: string;
}

interface PayrocHostedFieldsInstance {
  initialize(): Promise<void>;
  on(event: 'submissionSuccess', callback: (data: { token: string }) => void): void;
  on(event: 'submissionError', callback: () => void): void;
}

interface PayrocSdk {
  hostedFields: new (config: {
    sessionToken: string;
    mode: string;
    fields: {
      card: {
        cardholderName: { target: string; errorTarget: string };
        cardNumber: { target: string; errorTarget: string };
        expiryDate: { target: string; errorTarget: string };
        cvv: { target: string; errorTarget: string; wrapperTarget: boolean };
        submit: { target: string; value: string };
      };
    };
  }) => PayrocHostedFieldsInstance;
}

interface PayrocPaymentFormProps {
  amount: number;
  currency: string;
  onPaymentSuccess?: (result: unknown) => void;
  onPaymentError?: (error: unknown) => void;
  pledgeId?: number;
  contactId?: number;
}

declare global {
  interface Window {
    Payroc: PayrocSdk;
  }
}

export default function PayrocPaymentForm({
  amount,
  currency,
  onPaymentSuccess,
  onPaymentError,
  pledgeId,
  contactId,
}: PayrocPaymentFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [config, setConfig] = useState<PayrocConfig | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState("");

  const cardFormRef = useRef<PayrocHostedFieldsInstance | null>(null);

  // Prevent double runs in React Strict Mode
  const hasLoadedConfig = useRef(false);
  const hasCreatedSession = useRef(false);
  const hasInitializedHostedFields = useRef(false);

  /* -------------------------------------------------------------
   * STEP 1 — LOAD CONFIG ONCE
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (hasLoadedConfig.current) return;
    hasLoadedConfig.current = true;

    (async () => {
      try {
        const res = await fetch("/api/payroc");
        if (!res.ok) throw new Error("Failed to load config");
        const json = await res.json();
        setConfig(json.config);
      } catch (err) {
        toast.error("Failed to load Payroc configuration");
        setIsInitializing(false);
      }
    })();
  }, []);

  /* -------------------------------------------------------------
   * STEP 2 — LOAD SCRIPT ONCE
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (!config) return;

    if (document.getElementById("payroc-sdk")) {
      setScriptLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.id = "payroc-sdk";
    script.src = config.hostedFieldsScript;
    script.async = true;

    script.onload = () => {
      console.log("➡️ Payroc Hosted Fields script executed");
      setScriptLoaded(true);
    };

    script.onerror = () => {
      toast.error("Failed to load Payroc script");
      setIsInitializing(false);
    };

    document.body.appendChild(script);
  }, [config]);

  /* -------------------------------------------------------------
   * STEP 3 — CREATE SESSION TOKEN ONCE
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (!config || !scriptLoaded) return;
    if (hasCreatedSession.current) return;

    hasCreatedSession.current = true;

    (async () => {
      try {
        const res = await fetch("/api/payroc/hosted-session", { method: "POST" });
        if (!res.ok) throw new Error("Session failed");

        const json = await res.json();
        console.log("➡️ Session Token:", json.sessionToken);
        setSessionToken(json.sessionToken);
      } catch (e) {
        toast.error("Failed to create payment session");
        setIsInitializing(false);
      }
    })();
  }, [config, scriptLoaded]);

  /* -------------------------------------------------------------
   * STEP 4 — INITIALIZE HOSTED FIELDS ONCE
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (!sessionToken) return;
    if (hasInitializedHostedFields.current) return;

    hasInitializedHostedFields.current = true;

    const waitForSdk = () =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (window.Payroc?.hostedFields) return resolve();
          requestAnimationFrame(check);
        };
        check();
      });

    const waitForDom = () =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (
            document.getElementById("card-holder-name") &&
            document.getElementById("card-number") &&
            document.getElementById("card-expiry") &&
            document.getElementById("card-cvv") &&
            document.getElementById("submit-button")
          ) {
            return resolve();
          }
          requestAnimationFrame(check);
        };
        check();
      });

    const initialize = async () => {
      try {
        console.log("⏳ Waiting for Payroc SDK...");
        await waitForSdk();

        console.log("⏳ Waiting for DOM...");
        await waitForDom();

        console.log("⚡ Initializing Hosted Fields…");

        const cardForm = new window.Payroc.hostedFields({
          sessionToken,
          mode: "payment",
          fields: {
            card: {
              cardholderName: {
                target: "#card-holder-name",
                errorTarget: "#card-holder-name-error",
              },
              cardNumber: {
                target: "#card-number",
                errorTarget: "#card-number-error",
              },
              expiryDate: {
                target: "#card-expiry",
                errorTarget: "#card-expiry-error",
              },
              cvv: {
                target: "#card-cvv",
                errorTarget: "#card-cvv-error",
                wrapperTarget: false,
              },
              submit: {
                target: "#submit-button",
                value: "Process Payment",
              },
            },
          },
        });

        await cardForm.initialize();
        cardFormRef.current = cardForm;

        /* SUCCESS */
        cardForm.on("submissionSuccess", async ({ token }: { token: string }) => {
          setIsLoading(true);
          try {
            const res = await fetch("/api/payroc", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                token,
                amount,
                currency,
                paymentData: { pledgeId, contactId },
              }),
            });

            if (!res.ok) throw new Error("Payment failed");

            const result = await res.json();
            setModalMessage("Payment successful!");
            setIsModalOpen(true);
            onPaymentSuccess?.(result);
            setTimeout(() => {
              window.location.reload();
            }, 3000);
          } catch (err) {
            toast.error("Payment failed");
            onPaymentError?.(err);
          } finally {
            setIsLoading(false);
          }
        });

        /* ERROR */
        cardForm.on("submissionError", () => {
          toast.error("Invalid card details");
        });

        setIsInitializing(false);
      } catch (e) {
        console.error(e);
        toast.error("Failed to initialize Hosted Fields");
        setIsInitializing(false);
      }
    };

    initialize();
  }, [sessionToken]);

  /* -------------------------------------------------------------
   * UI
   * ------------------------------------------------------------- */
  return (
    <>
      <Card className="relative w-full max-w-md mx-auto">
        {isInitializing && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur flex items-center justify-center z-50">
            <div className="flex items-center gap-2 text-gray-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Initializing payment form…
            </div>
          </div>
        )}

        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Secure Payment
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Amount: {currency} {amount.toFixed(2)}
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          <div>
            <Label>Cardholder Name</Label>
            <div id="card-holder-name" className="border rounded p-3 bg-white" />
            <div id="card-holder-name-error" className="text-red-600 text-sm" />
          </div>

          <div>
            <Label>Card Number</Label>
            <div id="card-number" className="border rounded p-3 bg-white" />
            <div id="card-number-error" className="text-red-600 text-sm" />
          </div>

          <div>
            <Label>Expiry (MM/YY)</Label>
            <div id="card-expiry" className="border rounded p-3 bg-white" />
            <div id="card-expiry-error" className="text-red-600 text-sm" />
          </div>

          <div>
            <Label>CVV</Label>
            <div id="card-cvv" className="border rounded p-3 bg-white" />
            <div id="card-cvv-error" className="text-red-600 text-sm" />
          </div>

          <div className="pt-4">
            <div id="submit-button" />

            {isLoading && (
              <div className="mt-2 flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing…
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground pt-4 border-t">
            <Lock className="h-4 w-4" />
            <span>Your payment info is encrypted & secure</span>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment Status</DialogTitle>
          </DialogHeader>
          <DialogDescription>{modalMessage}</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}
