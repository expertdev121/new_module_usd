"use client";

import React from "react";
import PayrocPaymentForm from "@/components/forms/payroc-payment-form";

export default function PayrocTestPage() {
  return (
    <div className="container mx-auto p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Payroc Payment Test</h1>
        <p className="text-gray-600 mb-8">
          Test the Payroc Hosted Fields payment form integration.
        </p>

        <PayrocPaymentForm
          amount={100.00}
          currency="USD"
          onPaymentSuccess={(result) => {
            console.log("Payment successful:", result);
            alert("Payment processed successfully!");
          }}
          onPaymentError={(error) => {
            console.error("Payment failed:", error);
            alert("Payment failed. Check console for details.");
          }}
        />
      </div>
    </div>
  );
}
