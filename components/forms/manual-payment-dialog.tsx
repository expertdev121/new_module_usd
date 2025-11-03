"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ManualPaymentForm from "./manual-payment-form";
import type { ManualDonation } from "@/lib/types/manual-donations";

interface ManualPaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId?: number;
  manualDonation?: ManualDonation;
  isEditing?: boolean;
  onPaymentCreated?: () => void;
}

export default function ManualPaymentDialog({
  open,
  onOpenChange,
  contactId,
  manualDonation,
  isEditing = false,
  onPaymentCreated,
}: ManualPaymentDialogProps) {
  const handleSuccess = () => {
    onOpenChange(false);
    onPaymentCreated?.();
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Manual Donation" : "Create Manual Donation"}
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? `Edit the manual donation details for ${contactId ? `Contact #${contactId}` : "a contact"}.`
              : `Record a manual donation for ${contactId ? `Contact #${contactId}` : "a contact"}. This will create a standalone donation record that appears in the payments table.`
            }
          </DialogDescription>
        </DialogHeader>
        <ManualPaymentForm
          contactId={contactId}
          manualDonation={manualDonation}
          isEditing={isEditing}
          onSuccess={handleSuccess}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
