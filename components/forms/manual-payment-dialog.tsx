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
import { useContactQuery } from "@/lib/query/useContactDetails";
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
  const { data: contactData } = useContactQuery({ contactId: contactId || 0 });

  const handleSuccess = () => {
    onOpenChange(false);
    onPaymentCreated?.();
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const getContactDisplay = () => {
    if (!contactId) return "a contact";
    if (contactData?.contact) {
      return `${contactData.contact.firstName} ${contactData.contact.lastName}`;
    }
    return `Contact #${contactId}`;
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
              ? `Edit the manual donation details for ${getContactDisplay()}.`
              : `Record a manual donation for ${getContactDisplay()}. This will create a standalone donation record that appears in the payments table.`
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
