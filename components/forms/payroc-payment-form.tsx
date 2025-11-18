"use client";

import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, CreditCard, Lock } from "lucide-react";

interface PayrocConfig {
  merchantId: string;
  terminalId: string;
  apiKey: string;
  identityUrl: string;
  apiBaseUrl: string;
  hostedFieldsScript: string;
  libVersion: string;
}

interface PayrocPaymentFormProps {
  amount: number;
  currency: string;
  onPaymentSuccess?: (result: any) => void;
  onPaymentError?: (error: any) => void;
  pledgeId?: number;
  contactId?: number;
}

declare global {
  interface Window {
    Payroc: any;
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
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const cardFormRef = useRef<any>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  // Load Payroc configuration
  useEffect(() => {
    const loadConfig = async () => {
      try {
        const response = await fetch('/api/payroc');
        if (!response.ok) throw new Error('Failed to load Payroc config');
        const data = await response.json();
        setConfig(data.config);
      } catch (error) {
        console.error('Error loading Payroc config:', error);
        toast.error('Failed to load payment configuration');
        setIsInitializing(false);
      }
    };

    loadConfig();
  }, []);

  // Load Hosted Fields script
  useEffect(() => {
    if (!config) return;

    if (scriptRef.current) return; // Script already loaded

    const script = document.createElement('script');
    script.src = config.hostedFieldsScript;
    script.async = true;
    script.onload = () => {
      setScriptLoaded(true);
    };
    script.onerror = () => {
      toast.error('Failed to load payment script');
      setIsInitializing(false);
    };

    document.head.appendChild(script);
    scriptRef.current = script;

    return () => {
      if (scriptRef.current) {
        document.head.removeChild(scriptRef.current);
        scriptRef.current = null;
      }
    };
  }, [config]);

  // Create hosted fields session
  useEffect(() => {
    if (!scriptLoaded || !config) return;

    const createSession = async () => {
      try {
        const response = await fetch('/api/payroc?action=hosted-fields-session');
        if (!response.ok) throw new Error('Failed to create payment session');
        const data = await response.json();
        setSessionToken(data.sessionToken);
      } catch (error) {
        console.error('Error creating session:', error);
        toast.error('Failed to initialize payment form');
        setIsInitializing(false);
      }
    };

    createSession();
  }, [scriptLoaded, config]);

  // Initialize Payroc Hosted Fields
  useEffect(() => {
    if (!sessionToken || !window.Payroc || !config) return;

    try {
      const cardForm = new window.Payroc.hostedFields({
        sessionToken: sessionToken,
        mode: "payment",
        fields: {
          card: {
            cardholderName: {
              target: ".card-holder-name",
              errorTarget: ".card-holder-name-error"
            },
            cardNumber: {
              target: ".card-number",
              errorTarget: ".card-number-error"
            },
            expiryDate: {
              target: ".card-expiry",
              errorTarget: ".card-expiry-error"
            },
            cvv: {
              target: ".card-cvv",
              errorTarget: ".card-cvv-error"
            },
            submit: {
              target: ".submit-button",
              value: "Process Payment"
            }
          }
        }
      });

      cardForm.initialize();
      cardFormRef.current = cardForm;

      // Handle successful submission
      cardForm.on("submissionSuccess", async ({ token }: { token: string }) => {
        setIsLoading(true);
        try {
          // Process the payment with the token
          const paymentResponse = await fetch('/api/payroc', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              token,
              amount,
              currency,
              paymentData: {
                pledgeId,
                contactId,
              }
            }),
          });

          if (!paymentResponse.ok) {
            const errorData = await paymentResponse.json();
            throw new Error(errorData.error || 'Payment failed');
          }

          const paymentResult = await paymentResponse.json();
          toast.success('Payment processed successfully!');
          onPaymentSuccess?.(paymentResult);
        } catch (error) {
          console.error('Payment processing error:', error);
          toast.error(error instanceof Error ? error.message : 'Payment failed');
          onPaymentError?.(error);
        } finally {
          setIsLoading(false);
        }
      });

      // Handle submission errors
      cardForm.on("submissionError", (error: any) => {
        console.error('Submission error:', error);
        toast.error('Payment submission failed');
        onPaymentError?.(error);
        setIsLoading(false);
      });

      setIsInitializing(false);
    } catch (error) {
      console.error('Error initializing Payroc form:', error);
      toast.error('Failed to initialize payment form');
      setIsInitializing(false);
    }
  }, [sessionToken, config, amount, currency, pledgeId, contactId, onPaymentSuccess, onPaymentError]);

  if (isInitializing) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="p-6">
          <div className="flex items-center justify-center space-x-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Initializing payment form...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!config || !sessionToken) {
    return (
      <Card className="w-full max-w-md mx-auto">
        <CardContent className="p-6">
          <div className="text-center text-red-600">
            Failed to initialize payment form. Please try again.
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-5 w-5" />
          Secure Payment
        </CardTitle>
        <div className="text-sm text-muted-foreground">
          Amount: {currency} {amount.toFixed(2)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Cardholder Name */}
        <div className="space-y-2">
          <Label htmlFor="cardholder-name">Cardholder Name</Label>
          <div className="card-holder-name border rounded-md p-3 bg-white"></div>
          <div className="card-holder-name-error text-red-600 text-sm"></div>
        </div>

        {/* Card Number */}
        <div className="space-y-2">
          <Label htmlFor="card-number">Card Number</Label>
          <div className="card-number border rounded-md p-3 bg-white"></div>
          <div className="card-number-error text-red-600 text-sm"></div>
        </div>

        {/* Expiry Date */}
        <div className="space-y-2">
          <Label htmlFor="card-expiry">Expiry Date (MM/YY)</Label>
          <div className="card-expiry border rounded-md p-3 bg-white"></div>
          <div className="card-expiry-error text-red-600 text-sm"></div>
        </div>

        {/* CVV */}
        <div className="space-y-2">
          <Label htmlFor="card-cvv">CVV</Label>
          <div className="card-cvv border rounded-md p-3 bg-white"></div>
          <div className="card-cvv-error text-red-600 text-sm"></div>
        </div>

        {/* Submit Button */}
        <div className="pt-4">
          <div className="submit-button"></div>
          {isLoading && (
            <div className="flex items-center justify-center space-x-2 mt-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Processing payment...</span>
            </div>
          )}
        </div>

        {/* Security Notice */}
        <div className="flex items-center gap-2 text-sm text-muted-foreground pt-4 border-t">
          <Lock className="h-4 w-4" />
          <span>Your payment information is secure and encrypted</span>
        </div>
      </CardContent>
    </Card>
  );
}
