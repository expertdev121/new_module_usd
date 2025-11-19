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
  on(event: "submissionSuccess", cb: (data: { token: string }) => void): void;
  on(event: "submissionError", cb: () => void): void;
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

declare global {
  interface Window {
    Payroc: PayrocSdk;
  }
}

export default function PayrocPaymentForm({
  amount,
  onPaymentSuccess,
  onPaymentError,
  pledgeId,
  contactId,
}: {
  amount?: number;
  onPaymentSuccess?: (r: any) => void;
  onPaymentError?: (e: any) => void;
  pledgeId?: number;
  contactId?: number;
}) {
  /** UI State */
  const [isInitializing, setIsInitializing] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [config, setConfig] = useState<PayrocConfig | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMessage, setModalMessage] = useState("");

  /** Form fields */
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [paymentAmount, setPaymentAmount] = useState(amount || 0);
  const paymentCurrency = "USD";

  /** Prevent double runs */
  const hasLoadedConfig = useRef(false);
  const hasLoadedScript = useRef(false);
  const hasRequestedSession = useRef(false);
  const hasInitializedHostedFields = useRef(false);

  const cardFormRef = useRef<PayrocHostedFieldsInstance | null>(null);

  /* -------------------------------------------------------------
   * 1️⃣ LOAD CONFIG
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (hasLoadedConfig.current) return;
    hasLoadedConfig.current = true;

    console.log("DEBUG: Fetching /api/payroc config…");

    (async () => {
      try {
        const res = await fetch("/api/payroc");
        console.log("DEBUG: Config fetch status:", res.status);

        if (!res.ok) throw new Error(`Config fetch failed ${res.status}`);

        const json = await res.json();
        console.log("DEBUG: Config loaded:", json.config);
        setConfig(json.config);
      } catch (error) {
        console.error("DEBUG: Failed loading config:", error);
        toast.error("Failed to load Payroc configuration");
        setIsInitializing(false);
      }
    })();
  }, []);

  /* -------------------------------------------------------------
   * 2️⃣ LOAD PAYROC JS SDK
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (!config) return;
    if (hasLoadedScript.current) return;

    hasLoadedScript.current = true;

    console.log("DEBUG: Loading Payroc JS SDK:", config.hostedFieldsScript);

    const script = document.createElement("script");
    script.id = "payroc-sdk";
    script.src = config.hostedFieldsScript;
    script.async = true;

    script.onload = () => console.log("✔ Payroc SDK Loaded");
    script.onerror = () => {
      toast.error("Failed to load Payroc script");
      setIsInitializing(false);
    };

    document.body.appendChild(script);
  }, [config]);

  /* -------------------------------------------------------------
   * 3️⃣ CREATE HOSTED SESSION
   * ------------------------------------------------------------- */
  useEffect(() => {
    console.log("DEBUG: Session effect start");
    console.log("DEBUG: config?", !!config);
    console.log("DEBUG: Payroc SDK?", !!window.Payroc);
    console.log("DEBUG: alreadyRequested?", hasRequestedSession.current);

    if (!config) return;
    if (!window.Payroc) return;
    if (hasRequestedSession.current) return;

    hasRequestedSession.current = true;

    console.log("DEBUG: Requesting /api/payroc/hosted-session…");

    (async () => {
      try {
        const res = await fetch("/api/payroc/hosted-session", {
          method: "POST",
        });

        console.log("DEBUG: Hosted-session status:", res.status);

        if (!res.ok) throw new Error(`Hosted session failed ${res.status}`);

        const json = await res.json();
        console.log("✔ Session token:", json.sessionToken);
        setSessionToken(json.sessionToken);
      } catch (error) {
        console.error("DEBUG: Hosted-session failed:", error);
        toast.error("Failed to create Payroc session");
        setIsInitializing(false);
      }
    })();
  }, [config]);

  /* -------------------------------------------------------------
   * 4️⃣ INITIALIZE HOSTED FIELDS
   * ------------------------------------------------------------- */
  useEffect(() => {
    if (!sessionToken) return;
    if (hasInitializedHostedFields.current) return;

    hasInitializedHostedFields.current = true;

    const waitForDom = () =>
      new Promise<void>((resolve) => {
        const fields = [
          "#card-holder-name",
          "#card-number",
          "#card-expiry",
          "#card-cvv",
          "#submit-button",
        ];

        const check = () => {
          const ready = fields.every((f) => document.querySelector(f));
          if (ready) return resolve();
          requestAnimationFrame(check);
        };
        check();
      });

    const waitForSdk = () =>
      new Promise<void>((resolve) => {
        const check = () => {
          if (window.Payroc?.hostedFields) return resolve();
          requestAnimationFrame(check);
        };
        check();
      });

    const init = async () => {
      console.log("DEBUG: Waiting for SDK + DOM…");
      await waitForSdk();
      await waitForDom();

      console.log("⚡ Initializing Hosted Fields with session:", sessionToken);

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

      console.log("✔ Hosted Fields initialized");

      /** SUCCESS */
      cardForm.on("submissionSuccess", async ({ token }) => {
        console.log("DEBUG: Form submissionSuccess token:", token);

        setIsLoading(true);
        try {
          const res = await fetch("/api/payroc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              token,
              amount: paymentAmount,
              currency: paymentCurrency,
              paymentData: {
                pledgeId,
                contactId,
                firstName,
                lastName,
                email,
              },
            }),
          });

          if (!res.ok) throw new Error(`Payment failed`);

          const result = await res.json();

          console.log("✔ Payment success:", result);

          setModalMessage("Payment successful!");
          setIsModalOpen(true);

          onPaymentSuccess?.(result);
        } catch (err) {
          console.error("Payment failed:", err);
          toast.error("Payment failed");
          onPaymentError?.(err);
        } finally {
          setIsLoading(false);
        }
      });

      /** ERROR */
      cardForm.on("submissionError", () => {
        console.error("DEBUG: submissionError fired");
        toast.error("Invalid card details");
      });

      setIsInitializing(false);
    };

    console.log("DEBUG: Running Hosted Fields init…");
    init();
  }, [sessionToken]);

  /* -------------------------------------------------------------
   * UI
   * ------------------------------------------------------------- */
  return (
    <>
      <Card className="relative w-full max-w-md mx-auto">
        {isInitializing && (
          <div className="absolute inset-0 bg-white/90 backdrop-blur-sm flex items-center justify-center z-50">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="ml-2">Setting up secure payment form…</span>
          </div>
        )}

        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" /> Secure Payment
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* USER INPUT FIELDS */}
          <div>
            <Label>First Name</Label>
            <input
              className="w-full border rounded p-3"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div>
            <Label>Last Name</Label>
            <input
              className="w-full border rounded p-3"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
          <div>
            <Label>Email</Label>
            <input
              className="w-full border rounded p-3"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          {/* Hosted Fields Inputs */}
          <div>
            <Label>Cardholder Name</Label>
            <div id="card-holder-name" className="border rounded p-3 bg-white" />
            <div id="card-holder-name-error" className="text-red-500 text-sm" />
          </div>

          <div>
            <Label>Card Number</Label>
            <div id="card-number" className="border rounded p-3 bg-white" />
            <div id="card-number-error" className="text-red-500 text-sm" />
          </div>

          <div>
            <Label>Expiry</Label>
            <div id="card-expiry" className="border rounded p-3 bg-white" />
            <div id="card-expiry-error" className="text-red-500 text-sm" />
          </div>

          <div>
            <Label>CVV</Label>
            <div id="card-cvv" className="border rounded p-3 bg-white" />
            <div id="card-cvv-error" className="text-red-500 text-sm" />
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

          <div className="flex items-center gap-2 text-xs text-muted-foreground border-t pt-4">
            <Lock className="h-4 w-4" />
            <span>Your payment details are fully encrypted</span>
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
