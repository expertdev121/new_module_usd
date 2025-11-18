"use client";

import React, { useState } from "react";
import PayrocPaymentForm from "@/components/forms/payroc-payment-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function PayrocPublicPage() {
  const [isErrorModalOpen, setIsErrorModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  return (
    <>
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Make a Payment</h1>
            <p className="text-gray-600">Secure payment processing powered by Payroc</p>
          </div>
          <div className="flex justify-center">
            <PayrocPaymentForm
              onPaymentSuccess={(result) => {
                console.log("Payment successful:", result);
                alert("Payment processed successfully!");
              }}
              onPaymentError={(error) => {
                console.error("Payment failed:", error);
                setErrorMessage("Payment failed. Check console for details.");
                setIsErrorModalOpen(true);
              }}
            />
          </div>
        </div>
      </div>

      <Dialog open={isErrorModalOpen} onOpenChange={setIsErrorModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Payment Error</DialogTitle>
          </DialogHeader>
          <DialogDescription>{errorMessage}</DialogDescription>
        </DialogContent>
      </Dialog>
    </>
  );
}
