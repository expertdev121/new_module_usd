/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import type React from "react";
import { useEffect, useState, useRef, useMemo } from "react";
import { useForm } from "react-hook-form";

import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import {
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Trash2,
  Edit,
  Calculator,
  TrendingUp,
  CalendarIcon,
  RefreshCw,
  UserPlus,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

import { Input } from "@/components/ui/input";
import DateInput from "@/components/ui/date-input";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  usePaymentMethodOptions,
  usePaymentMethodDetailOptions
} from "@/lib/query/usePaymentMethods";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  useCreatePaymentPlanMutation,
  useUpdatePaymentPlanMutation,
  usePaymentPlanQuery,
  usePledgeDetailsQuery,
  usePauseResumePaymentPlanMutation,
  useDeletePaymentPlanMutation,
} from "@/lib/query/payment-plans/usePaymentPlanQuery";

import useContactId from "@/hooks/use-contact-id";
import { usePledgesQuery } from "@/lib/query/usePledgeData";
import { useExchangeRates } from "@/lib/query/useExchangeRates";
import { useQuery } from "@tanstack/react-query";

// Contact type definition
interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  displayName?: string | null;
  fullName?: string;
}

// Contacts hook - defined inline based on your existing pattern
const useContacts = (search?: string) => {
  return useQuery({
    queryKey: ["contacts", search],
    queryFn: async (): Promise<{ contacts: Contact[] }> => {
      if (!search || search.length < 2) return { contacts: [] };

      const response = await fetch(`/api/contacts/search?q=${encodeURIComponent(search)}`);
      if (!response.ok) {
        throw new Error("Failed to fetch contacts");
      }

      const data = await response.json();

      // Transform contacts to ensure fullName is available
      if (data.contacts) {
        data.contacts = data.contacts.map((contact: Contact) => ({
          ...contact,
          fullName: contact.fullName || contact.displayName || `${contact.firstName} ${contact.lastName}`.trim(),
        }));
      }

      return data;
    },
    enabled: !!search && search.length >= 2,
  });
};

// Supported currencies - matches your schema
const supportedCurrencies = [
  "USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR",
] as const;

// Frequency options - matches your schema
const frequencies = [
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "biannual", label: "Biannual" },
  { value: "annual", label: "Annual" },
  { value: "one_time", label: "One Time" },
  { value: "custom", label: "Custom" },
] as const;

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "overdue", label: "Overdue" },
] as const;

// Type-safe helper functions
const ensureCurrency = (value: string | undefined): typeof supportedCurrencies[number] => {
  if (value && supportedCurrencies.includes(value as typeof supportedCurrencies[number])) {
    return value as typeof supportedCurrencies[number];
  }
  return "USD";
};

const ensureFrequency = (value: string | undefined): typeof frequencies[number]['value'] => {
  const validFrequency = frequencies.find(f => f.value === value);
  return validFrequency ? validFrequency.value : "monthly";
};

const ensurePlanStatus = (value: string | undefined): typeof statusOptions[number]['value'] => {
  const validStatus = statusOptions.find(s => s.value === value);
  return validStatus ? validStatus.value : "active";
};

export const paymentPlanSchema = z.object({
  pledgeId: z.number().positive("Pledge ID is required"),
  relationshipId: z.number().optional(),
  planName: z.string().optional(),
  frequency: z.enum([
    "weekly",
    "monthly",
    "quarterly",
    "biannual",
    "annual",
    "one_time",
    "custom",
  ]),
  distributionType: z.enum(["fixed", "custom"]).default("fixed"),
  totalPlannedAmount: z
    .number()
    .positive("Total planned amount must be positive"),
  currency: z.enum(supportedCurrencies).default("USD"),
  // Multi-currency support fields
  totalPlannedAmountUsd: z.number().optional(),
  installmentAmount: z.number().positive("Installment amount must be positive"),
  installmentAmountUsd: z.number().optional(),
  numberOfInstallments: z
    .number()
    .int()
    .positive("Number of installments must be positive"),
  exchangeRate: z.number().optional(),
  startDate: z.string().min(1, "Start date is required"),
  endDate: z.string().optional(),
  nextPaymentDate: z.string().optional(),
  installmentsPaid: z.number().int().default(0),
  totalPaid: z.number().default(0),
  totalPaidUsd: z.number().optional(),
  remainingAmount: z.number().optional(),
  remainingAmountUsd: z.number().optional(),
  planStatus: z
    .enum(["active", "completed", "cancelled", "paused", "overdue"])
    .default("active"),
  autoRenew: z.boolean().default(false),
  remindersSent: z.number().int().default(0),
  lastReminderDate: z.string().optional(),
  currencyPriority: z.number().int().default(1),
  isActive: z.boolean().default(true),
  notes: z.string().optional(),
  internalNotes: z.string().optional(),
  // Third-party payment fields
  isThirdPartyPayment: z.boolean().optional(),
  thirdPartyContactId: z.number().optional().nullable(),
  customInstallments: z
    .array(
      z.object({
        installmentDate: z.string().min(1, "Installment date is required"),
        installmentAmount: z.number().positive("Installment amount must be positive"),
        currency: z.enum(supportedCurrencies),
        installmentAmountUsd: z.number().optional().nullable(),
        status: z.enum(["pending", "paid", "overdue", "cancelled"]).default("pending"),
        paidDate: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        paymentId: z.number().optional().nullable(),
      })
    )
    .optional(),
  // Payment method fields - NOW DYNAMIC
  paymentMethod: z.string({
    required_error: "Payment method is required",
    invalid_type_error: "Please select a valid payment method"
  }),
  methodDetail: z.string().optional(),
});

interface PaymentPlanDialogProps {
  // For create mode
  pledgeId?: number;
  contactId?: number;
  pledgeAmount?: number;
  pledgeCurrency?: string;
  pledgeDescription?: string;
  remainingBalance?: number;
  showPledgeSelector?: boolean;
  // For edit mode
  paymentPlanId?: number;
  mode?: "create" | "edit";
  // Trigger component
  trigger?: React.ReactNode;
  // Callbacks
  onSuccess?: () => void;
  onClose?: () => void;
  // New fields for distribution type
  distributionType?: "fixed" | "custom";
  customInstallments?: Array<{
    installmentDate: string;
    installmentAmount: number;
    currency: string;
    notes?: string;
  }>;
  // NEW: Add option to enable pledge selector in edit mode
  enablePledgeSelectorInEdit?: boolean;
}

// Helper function to fix precision errors in floating-point arithmetic
const roundToPrecision = (num: number, precision: number = 2): number => {
  return Math.round(num * Math.pow(10, precision)) / Math.pow(10, precision);
};

// Currency conversion helper function
const convertAmount = (
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  exchangeRates: Record<string, string> | undefined
): number => {
  if (!exchangeRates || fromCurrency === toCurrency) return amount;

  // Exchange rates are stored as USD per foreign currency
  // Example: if rate is 3.3462 for ILS, then 1 USD = 3.3462 ILS
  // Convert to USD first if not already USD
  let usdAmount = amount;
  if (fromCurrency !== "USD") {
    const fromRate = Number.parseFloat(exchangeRates[fromCurrency] || "1");
    // To convert from foreign currency to USD: divide by the rate
    usdAmount = amount / fromRate;
  }

  // Convert from USD to target currency
  if (toCurrency !== "USD") {
    const toRate = Number.parseFloat(exchangeRates[toCurrency] || "1");
    // To convert from USD to foreign currency: multiply by the rate
    return usdAmount * toRate;
  }

  return usdAmount;
};

// Exchange Rate Display Component
const ExchangeRateDisplay = ({
  currency,
  exchangeRates,
  isLoading,
}: {
  currency: string | undefined;
  exchangeRates: Record<string, string> | undefined;
  isLoading: boolean;
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <TrendingUp className="w-4 h-4 animate-pulse" />
        Loading exchange rates...
      </div>
    );
  }

  if (!exchangeRates || !currency || currency === "USD") return null;

  const rate = exchangeRates[currency];

  if (!rate) return null;

  const rateValue = Number.parseFloat(rate);
  const usdRate = 1 / rateValue;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <TrendingUp className="w-4 h-4" />
      <span>
        1 {currency} = {usdRate.toFixed(4)} USD
      </span>
    </div>
  );
};

export type PaymentPlanFormData = z.infer<typeof paymentPlanSchema>;

const calculateNextPaymentDate = (
  startDate: string,
  frequency: string
): string => {
  const start = new Date(startDate);
  const next = new Date(start);

  switch (frequency) {
    case "weekly":
      next.setDate(start.getDate() + 7);
      break;
    case "monthly":
      next.setMonth(start.getMonth() + 1);
      break;
    case "quarterly":
      next.setMonth(start.getMonth() + 3);
      break;
    case "biannual":
      next.setMonth(start.getMonth() + 6);
      break;
    case "annual":
      next.setFullYear(start.getFullYear() + 1);
      break;
    default:
      return startDate;
  }

  return next.toISOString().split("T")[0];
};

interface PreviewInstallment {
  installmentNumber: number;
  date: string;
  amount: number;
  currency: string;
  formattedDate: string;
  isPaid: boolean;
  notes?: string;
}

const generatePreviewInstallments = (
  startDate: string,
  frequency: string,
  numberOfInstallments: number,
  totalAmount: number,
  currency: string
): PreviewInstallment[] => {
  const installments: PreviewInstallment[] = [];
  const start = new Date(startDate);

  // Calculate installment amount with proper distribution
  const baseInstallmentAmount = roundToPrecision(totalAmount / numberOfInstallments, 2);
  const remainder = roundToPrecision(totalAmount - (baseInstallmentAmount * numberOfInstallments), 2);

  for (let i = 0; i < numberOfInstallments; i++) {
    const installmentDate = new Date(start);

    switch (frequency) {
      case "weekly":
        installmentDate.setDate(start.getDate() + i * 7);
        break;
      case "monthly":
        installmentDate.setMonth(start.getMonth() + i);
        break;
      case "quarterly":
        installmentDate.setMonth(start.getMonth() + i * 3);
        break;
      case "biannual":
        installmentDate.setMonth(start.getMonth() + i * 6);
        break;
      case "annual":
        installmentDate.setFullYear(start.getFullYear() + i);
        break;
      case "one_time":
        if (i > 0) break;
        break;
      default:
        installmentDate.setMonth(start.getMonth() + i);
    }

    // Add remainder to last installment to ensure total matches exactly
    let installmentAmount = baseInstallmentAmount;
    if (i === numberOfInstallments - 1 && remainder !== 0) {
      installmentAmount = roundToPrecision(baseInstallmentAmount + remainder, 2);
    }

    installments.push({
      installmentNumber: i + 1,
      date: installmentDate.toISOString().split("T")[0],
      amount: installmentAmount,
      currency: currency,
      formattedDate: installmentDate.toLocaleDateString(),
      isPaid: false,
      notes: undefined,
    });

    if (frequency === "one_time") break;
  }

  return installments;
};

const calculateEndDate = (
  startDate: string,
  frequency: string,
  installments: number
): string => {
  const start = new Date(startDate);
  const end = new Date(start);

  switch (frequency) {
    case "weekly":
      end.setDate(start.getDate() + (installments - 1) * 7);
      break;
    case "monthly":
      end.setMonth(start.getMonth() + (installments - 1));
      break;
    case "quarterly":
      end.setMonth(start.getMonth() + (installments - 1) * 3);
      break;
    case "biannual":
      end.setMonth(start.getMonth() + (installments - 1) * 6);
      break;
    case "annual":
      end.setFullYear(start.getFullYear() + (installments - 1));
      break;
    case "one_time":
      return startDate;
    default:
      return startDate;
  }
  return end.toISOString().split("T")[0];
};

export default function PaymentPlanDialog(props: PaymentPlanDialogProps) {
  const {
    pledgeId: initialPledgeId,
    pledgeAmount,
    pledgeCurrency,
    pledgeDescription,
    remainingBalance,
    showPledgeSelector = true,
    paymentPlanId,
    mode = "create",
    trigger,
    onSuccess,
    onClose,
    enablePledgeSelectorInEdit = true,
  } = props;

  const [open, setOpen] = useState(false);
  const [selectedPledgeId, setSelectedPledgeId] = useState<number | undefined>(
    initialPledgeId
  );
  const [isEditing, setIsEditing] = useState(mode === "create");
  const [manualInstallment, setManualInstallment] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [installmentsModified, setInstallmentsModified] = useState(false);
  const [submitError, setSubmitError] = useState<string>("");
  const previousCurrencyRef = useRef<string | undefined>(undefined);
  const previousTotalAmountRef = useRef<number | undefined>(undefined);
  const isFormInitializedRef = useRef(false);

  // Third-party payment state
  const [contactSearch, setContactSearch] = useState("");
  const [selectedThirdPartyContact, setSelectedThirdPartyContact] = useState<Contact | null>(null);

  // Dropdown state management variables
  const [paymentMethodOpen, setPaymentMethodOpen] = useState(false);
  const [methodDetailOpen, setMethodDetailOpen] = useState(false);
  const [pledgeSelectorOpen, setPledgeSelectorOpen] = useState(false);

  const { data: exchangeRateData, isLoading: isLoadingRates } =
    useExchangeRates();
  const exchangeRates = exchangeRateData?.data?.rates;

  const isEditMode = mode === "edit" && !!paymentPlanId;

  const { data: existingPlanData, isLoading: isLoadingPlan } =
    usePaymentPlanQuery(paymentPlanId || 0);

  const contactId = useContactId();

  // Fixed pledge ID logic for edit mode
  const pledgeDataId = useMemo(() => {
    if (isEditMode) {
      // In edit mode, prioritize the existing plan's pledge ID
      return existingPlanData?.paymentPlan?.pledgeId || selectedPledgeId;
    }
    return selectedPledgeId;
  }, [isEditMode, existingPlanData?.paymentPlan?.pledgeId, selectedPledgeId]);

  // Only fetch pledge details when we have a valid ID
  const { data: pledgeData, isLoading: isLoadingPledge } =
    usePledgeDetailsQuery(
      pledgeDataId as number,
      { enabled: !!pledgeDataId && pledgeDataId > 0 }
    );

  const createPaymentPlanMutation = useCreatePaymentPlanMutation();
  const updatePaymentPlanMutation = useUpdatePaymentPlanMutation();
  const pauseResumeMutation = usePauseResumePaymentPlanMutation();
  const deleteMutation = useDeletePaymentPlanMutation();

  const existingPlan = existingPlanData?.paymentPlan;
  const pledgeOwnerContactId = useMemo(() => {
    if (isEditMode && existingPlan) {
      return (existingPlan as any).contactId; // Pledge owner from the plan
    }
    if (pledgeData?.contact) {
      return pledgeData.contact.id;
    }
    return contactId; // Fallback to current user
  }, [isEditMode, existingPlan, pledgeData?.contact, contactId]);

  // Third-party handlers
  const handleThirdPartyToggle = (checked: boolean) => {
    form.setValue("isThirdPartyPayment", checked);

    if (!checked) {
      setSelectedThirdPartyContact(null);
      setContactSearch("");
      form.setValue("thirdPartyContactId", null);
    }
  };

  const handleContactSelect = (contact: any) => {
    setSelectedThirdPartyContact(contact);
    form.setValue("thirdPartyContactId", contact.id);
    setContactSearch("");
  };

  // Initialize selected pledge ID earlier and more reliably
  useEffect(() => {
    if (isEditMode && existingPlanData?.paymentPlan?.pledgeId && !selectedPledgeId) {
      setSelectedPledgeId(existingPlanData.paymentPlan.pledgeId);
    }
  }, [existingPlanData?.paymentPlan?.pledgeId, isEditMode, selectedPledgeId]);


  // Get pledge data based on selected pledge in edit mode
  const effectivePledgeAmount =
    isEditMode && existingPlan
      ? Number.parseFloat(existingPlan?.pledgeOriginalAmount?.toString() || "0")
      : pledgeAmount || (pledgeData?.pledge.originalAmount ?? 0);

  const effectivePledgeCurrency =
    isEditMode && existingPlan
      ? existingPlan?.currency
      : pledgeCurrency || (pledgeData?.pledge.currency ?? "USD");

  const effectivePledgeDescription =
    isEditMode && existingPlan
      ? existingPlan?.pledgeDescription || `Pledge #${existingPlan?.pledgeId}`
      : pledgeDescription ||
      (pledgeData?.pledge.description ?? `Pledge #${selectedPledgeId}`);

  const effectiveRemainingBalance =
    isEditMode && existingPlan
      ? Number.parseFloat(existingPlan?.remainingAmount?.toString() || "0")
      : remainingBalance ||
      (pledgeData?.pledge.remainingBalance ?? effectivePledgeAmount);

  const defaultAmount = effectiveRemainingBalance || effectivePledgeAmount;


  // Calculate USD amounts for multi-currency support
  function calculateUsdAmounts(amount: number, currency: string) {
    if (!exchangeRates || currency === "USD") {
      return { usdAmount: undefined, exchangeRate: undefined };
    }
    const rate = parseFloat(exchangeRates[currency] || "1");
    return { usdAmount: amount / rate, exchangeRate: rate };
  }

  const getDefaultPledgeId = () => {
    if (selectedPledgeId) return selectedPledgeId;
    if (initialPledgeId) return initialPledgeId;
    if (isEditMode && existingPlan) return existingPlan.pledgeId;
    return 0;
  };

  const form = useForm({
    resolver: zodResolver(paymentPlanSchema),
    defaultValues: {
      pledgeId: getDefaultPledgeId(),
      relationshipId: undefined,
      planName: "",
      frequency: "monthly" as const,
      distributionType: "fixed" as const,
      totalPlannedAmount: defaultAmount,
      currency: ensureCurrency(effectivePledgeCurrency),
      totalPlannedAmountUsd: undefined,
      installmentAmount: 0,
      installmentAmountUsd: undefined,
      numberOfInstallments: 12,
      exchangeRate: undefined,
      startDate: new Date().toISOString().split("T")[0],
      endDate: "",
      nextPaymentDate: "",
      installmentsPaid: 0,
      totalPaid: 0,
      totalPaidUsd: undefined,
      remainingAmount: undefined,
      remainingAmountUsd: undefined,
      planStatus: "active" as const,
      autoRenew: false,
      remindersSent: 0,
      lastReminderDate: undefined,
      currencyPriority: 1,
      isActive: true,
      notes: "",
      internalNotes: "",
      customInstallments: undefined,
      paymentMethod: undefined,
      methodDetail: "",
      // Third-party defaults
      isThirdPartyPayment: false,
      thirdPartyContactId: null,
    },
  });
  // Preview Component
  const PaymentPlanPreview = ({
    formData,
    onConfirm,
    onEdit,
    isLoading = false,
    isEditMode = false,
    installmentsModified = false,
    exchangeRates,
  }: {
    formData: PaymentPlanFormData;
    onConfirm: () => void;
    onEdit: () => void;
    isLoading?: boolean;
    isEditMode?: boolean;
    installmentsModified?: boolean;
    exchangeRates?: Record<string, string>;
  }) => {
    const previewInstallments = useMemo(() => {
      if (formData.distributionType === "custom" && formData.customInstallments) {
        return formData.customInstallments.map((inst, index) => ({
          installmentNumber: index + 1,
          date: inst.installmentDate,
          amount: inst.installmentAmount,
          currency: inst.currency,
          formattedDate: new Date(inst.installmentDate).toLocaleDateString(),
          notes: inst.notes,
          isPaid: inst.status === "paid",
        }));
      } else {
        return generatePreviewInstallments(
          formData.startDate,
          formData.frequency,
          formData.numberOfInstallments,
          formData.totalPlannedAmount,
          formData.currency
        );
      }
    }, [formData]);

    const totalPreviewAmount = previewInstallments.reduce((sum, inst) => sum + inst.amount, 0);

    // Calculate USD equivalent
    const usdEquivalent = useMemo(() => {
      if (!exchangeRates || formData.currency === "USD") {
        return formData.currency === "USD" ? totalPreviewAmount : null;
      }
      return convertAmount(totalPreviewAmount, formData.currency, "USD", exchangeRates);
    }, [totalPreviewAmount, formData.currency, exchangeRates]);

    return (
      <div className="space-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold">Payment Plan Preview</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Review the payment schedule before confirming
          </p>
        </div>

        {/* Show warning for fixed plans being converted */}
        {isEditMode && formData.distributionType === "fixed" && installmentsModified && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-3">
              <div className="flex items-center">
                <AlertTriangle className="w-4 h-4 text-amber-600 mr-2" />
                <span className="text-sm text-amber-700">
                  This plan will be converted from fixed to custom distribution due to installment modifications.
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-blue-900 text-base">Plan Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-blue-700">Total Amount:</span>
                <span className="font-medium ml-2">
                  {formData.currency} {formData.totalPlannedAmount.toLocaleString()}
                </span>
              </div>
              {usdEquivalent && formData.currency !== "USD" && (
                <div>
                  <span className="text-blue-700">USD Equivalent:</span>
                  <span className="font-medium ml-2">
                    ${roundToPrecision(usdEquivalent, 2).toLocaleString()}
                  </span>
                </div>
              )}
              <div>
                <span className="text-blue-700">Frequency:</span>
                <span className="font-medium ml-2 capitalize">
                  {formData.frequency.replace('_', ' ')}
                </span>
              </div>
              {formData.paymentMethod && (
                <div>
                  <span className="text-blue-700">Payment Method:</span>
                  <span className="font-medium ml-2">
                    {paymentMethodOptions.find(m => m.value === formData.paymentMethod)?.label ||
                      formData.paymentMethod.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                </div>
              )}
              {formData.methodDetail && (
                <div className="col-span-2">
                  <span className="text-blue-700">Method Detail:</span>
                  <span className="font-medium ml-2">
                    {methodDetailOptions.find(m => m.value === formData.methodDetail)?.label ||
                      formData.methodDetail.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                </div>
              )}
              <div>
                <span className="text-blue-700">Distribution:</span>
                <span className="font-medium ml-2">
                  {formData.distributionType === 'custom' ? 'Custom Schedule' : 'Fixed Amount'}
                </span>
              </div>
              <div>
                <span className="text-blue-700">Total Installments:</span>
                <span className="font-medium ml-2">{previewInstallments.length}</span>
              </div>
              {formData.distributionType !== 'custom' && (
                <div>
                  <span className="text-blue-700">Per Installment:</span>
                  <span className="font-medium ml-2">
                    {formData.currency} {formData.installmentAmount.toLocaleString()}
                  </span>
                </div>
              )}
              <div>
                <span className="text-blue-700">Start Date:</span>
                <span className="font-medium ml-2">
                  {new Date(formData.startDate).toLocaleDateString()}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Payment Schedule</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-96 overflow-y-auto">
              {previewInstallments.map((installment, index) => (
                <div
                  key={index}
                  className={`px-4 py-3 border-b last:border-b-0 flex items-center justify-between ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                    }`}
                >
                  <div className="flex items-center space-x-4">
                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm font-medium">
                      {installment.installmentNumber}
                    </div>
                    <div>
                      <div className="font-medium">{installment.formattedDate}</div>
                      <div className="text-sm text-gray-500">{installment.date}</div>
                      {installment.notes && (
                        <div className="text-xs text-gray-400 mt-1">{installment.notes}</div>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-medium">
                      {installment.currency} {installment.amount.toLocaleString()}
                    </div>
                    <div className="text-sm text-gray-500">
                      {formData.distributionType === 'custom' ? 'Custom' : 'Fixed'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {Math.abs(totalPreviewAmount - formData.totalPlannedAmount) > 0.01 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="p-3">
              <div className="flex items-center">
                <AlertTriangle className="w-4 h-4 text-amber-600 mr-2" />
                <span className="text-sm text-amber-700">
                  Warning: Total installments ({formData.currency} {totalPreviewAmount.toLocaleString()})
                  differ from planned amount ({formData.currency} {formData.totalPlannedAmount.toLocaleString()})
                  by {formData.currency} {Math.abs(totalPreviewAmount - formData.totalPlannedAmount).toLocaleString()}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="border-green-200 bg-green-50">
          <CardContent className="p-4">
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium text-green-900">
                  Total: {formData.currency} {totalPreviewAmount.toLocaleString()}
                  {usdEquivalent && formData.currency !== "USD" && (
                    <span className="text-sm text-green-700 ml-2">
                      (~${roundToPrecision(usdEquivalent, 2).toLocaleString()} USD)
                    </span>
                  )}
                </div>
                <div className="text-sm text-green-700">
                  {previewInstallments.length} payments over {
                    formData.distributionType === 'custom'
                      ? 'custom schedule'
                      : `${formData.numberOfInstallments} ${formData.frequency} periods`
                  }
                </div>
              </div>
              <div className="text-right">
                <div className="text-sm text-green-700">
                  {formData.endDate && (
                    <>End Date: {new Date(formData.endDate).toLocaleDateString()}</>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end space-x-3 pt-4 border-t">
          <Button
            type="button"
            variant="outline"
            onClick={onEdit}
            disabled={isLoading}
          >
            <Edit className="w-4 h-4 mr-2" />
            Edit Plan
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            className="text-white"
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                Confirming...
              </>
            ) : (
              <>
                <Check className="w-4 h-4 mr-2" />
                Confirm & Create Plan
              </>
            )}
          </Button>
        </div>
      </div>
    );
  };
  const watchedFrequency = form.watch("frequency");
  const watchedStartDate = form.watch("startDate");
  const watchedNumberOfInstallments = form.watch("numberOfInstallments");
  const watchedTotalPlannedAmount = form.watch("totalPlannedAmount");
  const watchedInstallmentAmount = form.watch("installmentAmount");
  const watchedCurrency = form.watch("currency");
  const watchedDistributionType = form.watch("distributionType");
  const { options: paymentMethodOptions, isLoading: isLoadingPaymentMethods } = usePaymentMethodOptions();

  const watchedPaymentMethodRef = useRef<string | undefined>(undefined);
  const currentPaymentMethod = form.watch("paymentMethod");

  const { options: methodDetailOptions, isLoading: isLoadingDetailOptions } =
    usePaymentMethodDetailOptions(watchedPaymentMethodRef.current);
  const regenerateInstallments = () => {
    const currentData = form.getValues();

    if (!currentData.startDate || !currentData.frequency || currentData.numberOfInstallments <= 0 || currentData.totalPlannedAmount <= 0) {
      return;
    }

    const safeCurrency = ensureCurrency(currentData.currency);
    const newInstallments = generatePreviewInstallments(
      currentData.startDate,
      currentData.frequency,
      currentData.numberOfInstallments,
      currentData.totalPlannedAmount,
      safeCurrency
    ).map(inst => ({
      installmentDate: inst.date,
      installmentAmount: inst.amount,
      currency: safeCurrency,
      installmentAmountUsd: calculateUsdAmounts(inst.amount, safeCurrency).usdAmount,
      status: "pending" as const,
      paidDate: undefined,
      notes: undefined,
      paymentId: undefined,
    }));

    form.setValue("customInstallments", newInstallments);

    if (isEditMode) {
      setInstallmentsModified(true);
    }
  };

  // Watch for changes that should trigger installment regeneration
  useEffect(() => {
    if (!isFormInitializedRef.current) return;

    // Only auto-regenerate if we have custom installments (edit mode or custom distribution)
    const hasCustomInstallments = form.watch("customInstallments") && form.watch("customInstallments")!.length > 0;

    if (isEditMode && hasCustomInstallments) {
      // Check if critical parameters changed
      const currentTotalAmount = watchedTotalPlannedAmount;
      const currentCurrency = watchedCurrency;

      const totalAmountChanged = previousTotalAmountRef.current !== undefined &&
        Math.abs((previousTotalAmountRef.current || 0) - currentTotalAmount) > 0.01;

      const currencyChanged = previousCurrencyRef.current !== undefined &&
        previousCurrencyRef.current !== currentCurrency;

      if (totalAmountChanged || currencyChanged) {
        // Show option to regenerate installments
        regenerateInstallments();
      }

      previousTotalAmountRef.current = currentTotalAmount;
    }
  }, [watchedTotalPlannedAmount, watchedCurrency, isEditMode, form]);

  // Auto-generate installments for fixed plans in edit mode
  useEffect(() => {
    if (isEditMode && existingPlan && isFormInitializedRef.current) {
      // If it's a fixed plan, generate installments for editing
      if (existingPlan.distributionType === "fixed") {
        const safeCurrency = ensureCurrency(existingPlan.currency);
        const generatedInstallments = generatePreviewInstallments(
          existingPlan.startDate?.split("T")[0] || "",
          existingPlan.frequency,
          existingPlan.numberOfInstallments || 1,
          Number.parseFloat(existingPlan.totalPlannedAmount?.toString() || "0"),
          safeCurrency
        ).map(inst => ({
          installmentDate: inst.date,
          installmentAmount: inst.amount,
          currency: safeCurrency,
          installmentAmountUsd: calculateUsdAmounts(inst.amount, safeCurrency).usdAmount,
          status: "pending" as const,
          paidDate: undefined,
          notes: undefined,
          paymentId: undefined,
        }));

        form.setValue("customInstallments", generatedInstallments);
      }
    }
  }, [existingPlan, isEditMode, form, isFormInitializedRef.current]);
  // Track if this is the first render
  const isInitialRenderRef = useRef(true);

  useEffect(() => {
    const previousMethod = watchedPaymentMethodRef.current;
    watchedPaymentMethodRef.current = currentPaymentMethod;

    // Only clear method detail if payment method actually changed (not on initial load)
    if (!isInitialRenderRef.current && previousMethod && previousMethod !== currentPaymentMethod) {
      form.setValue("methodDetail", "");
    }

    // Mark that initial render is complete
    if (isInitialRenderRef.current && currentPaymentMethod) {
      isInitialRenderRef.current = false;
    }
  }, [currentPaymentMethod, form]);

  // Enhanced currency conversion effect
  useEffect(() => {
    if (isEditMode && !isFormInitializedRef.current) {
      previousCurrencyRef.current = ensureCurrency(watchedCurrency);
      previousTotalAmountRef.current = watchedTotalPlannedAmount;
      return;
    }

    if (
      !isFormInitializedRef.current ||
      !exchangeRates ||
      !previousCurrencyRef.current ||
      !watchedCurrency ||
      previousCurrencyRef.current === watchedCurrency
    ) {
      previousCurrencyRef.current = ensureCurrency(watchedCurrency);
      previousTotalAmountRef.current = watchedTotalPlannedAmount;
      return;
    }

    const currentAmount = form.getValues("totalPlannedAmount");
    if (currentAmount > 0) {
      const safeCurrency = ensureCurrency(watchedCurrency);
      const convertedAmount = convertAmount(
        currentAmount,
        previousCurrencyRef.current,
        safeCurrency,
        exchangeRates
      );
      const roundedAmount = roundToPrecision(convertedAmount, 2);
      form.setValue("totalPlannedAmount", roundedAmount);

      // Update USD amounts
      const { usdAmount, exchangeRate } = calculateUsdAmounts(roundedAmount, safeCurrency);
      form.setValue("totalPlannedAmountUsd", usdAmount);
      form.setValue("exchangeRate", exchangeRate);

      // Update custom installments with currency conversion
      const customInstallments = form.getValues("customInstallments");
      if (customInstallments && customInstallments.length > 0) {
        const convertedInstallments = customInstallments.map(inst => {
          const convertedInstAmount = roundToPrecision(convertAmount(
            inst.installmentAmount,
            previousCurrencyRef.current!,
            safeCurrency,
            exchangeRates
          ), 2);
          const { usdAmount: instUsdAmount } = calculateUsdAmounts(convertedInstAmount, safeCurrency);

          return {
            ...inst,
            installmentAmount: convertedInstAmount,
            currency: safeCurrency,
            installmentAmountUsd: instUsdAmount,
          };
        });
        form.setValue("customInstallments", convertedInstallments);

        if (isEditMode) {
          setInstallmentsModified(true);
        }
      }

      if (!manualInstallment) {
        const installments = form.getValues("numberOfInstallments");
        if (installments > 0) {
          const newInstallmentAmount = roundToPrecision(roundedAmount / installments, 2);
          const { usdAmount: instUsdAmount } = calculateUsdAmounts(newInstallmentAmount, safeCurrency);
          form.setValue("installmentAmount", newInstallmentAmount);
          form.setValue("installmentAmountUsd", instUsdAmount);
        }
      }
    }

    previousCurrencyRef.current = ensureCurrency(watchedCurrency);
    previousTotalAmountRef.current = watchedTotalPlannedAmount;
  }, [watchedCurrency, exchangeRates, form, manualInstallment, isEditMode]);

  // Initialize form with existing plan data
  useEffect(() => {
    if (isEditMode && existingPlan && !isFormInitializedRef.current) {
      console.log("Existing plan data:", existingPlan);
      console.log("Payment Method:", existingPlan.paymentMethod);
      console.log("Method Detail:", existingPlan.methodDetail);
      const planData = {
        pledgeId: existingPlan.pledgeId,
        relationshipId: existingPlan.relationshipId || undefined,
        planName: existingPlan.planName || "",
        frequency: ensureFrequency(existingPlan.frequency),
        distributionType: (existingPlan.distributionType as "fixed" | "custom") || "fixed",
        totalPlannedAmount: Number.parseFloat(
          existingPlan.totalPlannedAmount?.toString() || "0"
        ),
        currency: ensureCurrency(existingPlan.currency),
        totalPlannedAmountUsd: existingPlan.totalPlannedAmountUsd ?
          Number.parseFloat(existingPlan.totalPlannedAmountUsd.toString()) : undefined,
        installmentAmount: Number.parseFloat(
          existingPlan.installmentAmount?.toString() || "0"
        ),
        installmentAmountUsd: existingPlan.installmentAmountUsd ?
          Number.parseFloat(existingPlan.installmentAmountUsd.toString()) : undefined,
        numberOfInstallments: existingPlan.numberOfInstallments || 1,
        exchangeRate: existingPlan.exchangeRate ?
          Number.parseFloat(existingPlan.exchangeRate.toString()) : undefined,
        startDate: existingPlan.startDate?.split("T")[0] || "",
        endDate: existingPlan.endDate?.split("T")[0] || "",
        nextPaymentDate: existingPlan.nextPaymentDate?.split("T")[0] || "",
        installmentsPaid: existingPlan.installmentsPaid || 0,
        totalPaid: Number.parseFloat(existingPlan.totalPaid?.toString() || "0"),
        totalPaidUsd: existingPlan.totalPaidUsd ?
          Number.parseFloat(existingPlan.totalPaidUsd.toString()) : undefined,
        remainingAmount: Number.parseFloat(existingPlan.remainingAmount?.toString() || "0"),
        remainingAmountUsd: existingPlan.remainingAmountUsd ?
          Number.parseFloat(existingPlan.remainingAmountUsd.toString()) : undefined,
        planStatus: ensurePlanStatus(existingPlan.planStatus),
        autoRenew: existingPlan.autoRenew || false,
        remindersSent: existingPlan.remindersSent || 0,
        lastReminderDate: existingPlan.lastReminderDate?.split("T")[0] || undefined,
        currencyPriority: existingPlan.currencyPriority || 1,
        isActive: existingPlan.isActive !== false,
        notes: existingPlan.notes || "",
        internalNotes: existingPlan.internalNotes || "",
        customInstallments: existingPlan.customInstallments ? existingPlan.customInstallments.map(inst => ({
          installmentDate: inst.installmentDate,
          installmentAmount: inst.installmentAmount,
          currency: ensureCurrency(inst.currency),
          installmentAmountUsd: inst.installmentAmountUsd,
          status: inst.status,
          paidDate: inst.paidDate || undefined,
          notes: inst.notes || undefined,
          paymentId: inst.paymentId || undefined,
        })) : undefined,
        paymentMethod: existingPlan.paymentMethod as any,
        methodDetail: existingPlan.methodDetail || "",
        // Third-party fields from API response
        isThirdPartyPayment: (existingPlan as any).isThirdPartyPayment || false,
        thirdPartyContactId: null, // Will be set when pledge data loads
      };

      form.reset(planData);

      // Set third-party contact if exists
      if ((existingPlan as any).isThirdPartyPayment && pledgeData?.contact) {
        // The pledge owner is the beneficiary in a third-party payment
        setSelectedThirdPartyContact({
          id: pledgeData.contact.id,
          firstName: pledgeData.contact.firstName || '',
          lastName: pledgeData.contact.lastName || '',
          fullName: pledgeData.contact.fullName || `${pledgeData.contact.firstName} ${pledgeData.contact.lastName}`.trim(),
        });
        form.setValue("thirdPartyContactId", pledgeData.contact.id);
      }

      previousCurrencyRef.current = ensureCurrency(existingPlan.currency);
      previousTotalAmountRef.current = Number.parseFloat(existingPlan.totalPlannedAmount?.toString() || "0");
      isFormInitializedRef.current = true;
    }
  }, [existingPlan, isEditMode, form, pledgeData?.contact]);

  useEffect(() => {
    if (isEditMode && existingPlan && (existingPlan as any).isThirdPartyPayment && pledgeData?.contact) {
      // Always set the third-party contact when dialog opens with existing third-party plan
      setSelectedThirdPartyContact({
        id: pledgeData.contact.id,
        firstName: pledgeData.contact.firstName,
        lastName: pledgeData.contact.lastName,
        fullName: pledgeData.contact.fullName || `${pledgeData.contact.firstName} ${pledgeData.contact.lastName}`.trim(),
      })

      // Update form values
      form.setValue('isThirdPartyPayment', true)
      form.setValue('thirdPartyContactId', pledgeData.contact.id)
    }
  }, [existingPlan, isEditMode, pledgeData?.contact, form, open]) // Add 'open' to dependencies


  useEffect(() => {
    if (selectedPledgeId) {
      form.setValue('pledgeId', selectedPledgeId);
    }
  }, [selectedPledgeId, form]);


  // Initialize form for create mode
  useEffect(() => {
    if (!isEditMode && pledgeData?.pledge) {
      const newDefaultAmount =
        pledgeData.pledge.remainingBalance || pledgeData.pledge.originalAmount;
      const safeCurrency = ensureCurrency(pledgeData.pledge.currency);
      form.setValue("totalPlannedAmount", newDefaultAmount);
      form.setValue("currency", safeCurrency);

      // Update USD amounts
      const { usdAmount, exchangeRate } = calculateUsdAmounts(newDefaultAmount, safeCurrency);
      form.setValue("totalPlannedAmountUsd", usdAmount);
      form.setValue("exchangeRate", exchangeRate);

      previousCurrencyRef.current = safeCurrency;
      previousTotalAmountRef.current = newDefaultAmount;
      isFormInitializedRef.current = true;
    }
  }, [pledgeData, form, isEditMode]);

  useEffect(() => {
    if (!isEditMode && initialPledgeId && !selectedPledgeId) {
      setSelectedPledgeId(initialPledgeId);
    }
  }, [initialPledgeId, isEditMode, selectedPledgeId]);

  useEffect(() => {
    if (
      !isEditMode &&
      !isFormInitializedRef.current &&
      effectivePledgeCurrency
    ) {
      previousCurrencyRef.current = ensureCurrency(effectivePledgeCurrency);
      previousTotalAmountRef.current = defaultAmount;
      isFormInitializedRef.current = true;
    }
  }, [isEditMode, effectivePledgeCurrency, defaultAmount]);

  // Enhanced automatic calculation for fixed distribution
  useEffect(() => {
    if (!manualInstallment && watchedDistributionType !== "custom") {
      const totalAmount = watchedTotalPlannedAmount;
      const installments = watchedNumberOfInstallments;

      if (totalAmount && installments > 0) {
        // Calculate base installment amount
        const baseAmount = roundToPrecision(totalAmount / installments, 2);

        // Calculate what the total would be with this amount
        const calculatedTotal = baseAmount * installments;
        const difference = roundToPrecision(totalAmount - calculatedTotal, 2);

        // If there's a significant difference, adjust the installment amount slightly
        let finalAmount = baseAmount;
        if (Math.abs(difference) > 0.01) {
          // Add the difference to the base amount to maintain total
          finalAmount = roundToPrecision(baseAmount + (difference / installments), 2);
        }

        form.setValue("installmentAmount", finalAmount);

        // Update USD amount
        const safeCurrency = ensureCurrency(watchedCurrency);
        const { usdAmount } = calculateUsdAmounts(finalAmount, safeCurrency);
        form.setValue("installmentAmountUsd", usdAmount);
      }
    }
  }, [
    watchedTotalPlannedAmount,
    watchedNumberOfInstallments,
    watchedCurrency,
    form,
    manualInstallment,
    watchedDistributionType
  ]);

  // Update remaining amount calculation
  useEffect(() => {
    const totalPlanned = watchedTotalPlannedAmount;
    const totalPaid = form.watch("totalPaid") || 0;
    const remaining = totalPlanned - totalPaid;

    form.setValue("remainingAmount", remaining);

    // Update USD amount
    const safeCurrency = ensureCurrency(watchedCurrency);
    const { usdAmount } = calculateUsdAmounts(remaining, safeCurrency);
    form.setValue("remainingAmountUsd", usdAmount);
  }, [watchedTotalPlannedAmount, watchedCurrency, form]);

  useEffect(() => {
    if (
      manualInstallment &&
      watchedInstallmentAmount > 0 &&
      watchedTotalPlannedAmount > 0
    ) {
      const calculatedInstallments = Math.ceil(
        watchedTotalPlannedAmount / watchedInstallmentAmount
      );
      form.setValue("numberOfInstallments", calculatedInstallments);
    }
  }, [
    watchedInstallmentAmount,
    watchedTotalPlannedAmount,
    form,
    manualInstallment,
  ]);

  useEffect(() => {
    if (watchedStartDate && watchedFrequency) {
      const nextPayment = calculateNextPaymentDate(
        watchedStartDate,
        watchedFrequency
      );
      form.setValue("nextPaymentDate", nextPayment);

      if (watchedNumberOfInstallments > 0) {
        const endDate = calculateEndDate(
          watchedStartDate,
          watchedFrequency,
          watchedNumberOfInstallments
        );
        form.setValue("endDate", endDate);
      }
    }
  }, [watchedStartDate, watchedFrequency, watchedNumberOfInstallments, form]);

  useEffect(() => {
    const distributionType = form.watch("distributionType");
    const customInstallments = form.watch("customInstallments");

    if (distributionType === "custom" && customInstallments) {
      const numberOfCustomInstallments = customInstallments.length;
      const currentNumberOfInstallments = form.getValues("numberOfInstallments");

      if (numberOfCustomInstallments !== currentNumberOfInstallments) {
        form.setValue("numberOfInstallments", numberOfCustomInstallments);
      }
    }
  }, [form.watch("distributionType"), form.watch("customInstallments"), form]);

  const resetForm = () => {
    setManualInstallment(false);
    setInstallmentsModified(false);
    setSubmitError("");
    setContactSearch("");
    setSelectedThirdPartyContact(null);
    isFormInitializedRef.current = false;
    previousCurrencyRef.current = undefined;
    previousTotalAmountRef.current = undefined;

    // Reset dropdown states
    setPaymentMethodOpen(false);
    setMethodDetailOpen(false);
    setPledgeSelectorOpen(false);

    if (isEditMode && existingPlan) {
      const originalPlanData = {
        pledgeId: existingPlan.pledgeId,
        relationshipId: existingPlan.relationshipId || undefined,
        planName: existingPlan.planName || "",
        frequency: ensureFrequency(existingPlan.frequency),
        distributionType: (existingPlan.distributionType as "fixed" | "custom") || "fixed",
        totalPlannedAmount: Number.parseFloat(
          existingPlan.totalPlannedAmount?.toString() || "0"
        ),
        currency: ensureCurrency(existingPlan.currency),
        totalPlannedAmountUsd: existingPlan.totalPlannedAmountUsd ?
          Number.parseFloat(existingPlan.totalPlannedAmountUsd.toString()) : undefined,
        installmentAmount: Number.parseFloat(
          existingPlan.installmentAmount?.toString() || "0"
        ),
        installmentAmountUsd: existingPlan.installmentAmountUsd ?
          Number.parseFloat(existingPlan.installmentAmountUsd.toString()) : undefined,
        numberOfInstallments: existingPlan.numberOfInstallments || 1,
        exchangeRate: existingPlan.exchangeRate ?
          Number.parseFloat(existingPlan.exchangeRate.toString()) : undefined,
        startDate: existingPlan.startDate?.split("T")[0] || "",
        endDate: existingPlan.endDate?.split("T")[0] || "",
        nextPaymentDate: existingPlan.nextPaymentDate?.split("T")[0] || "",
        installmentsPaid: existingPlan.installmentsPaid || 0,
        totalPaid: Number.parseFloat(existingPlan.totalPaid?.toString() || "0"),
        totalPaidUsd: existingPlan.totalPaidUsd ?
          Number.parseFloat(existingPlan.totalPaidUsd.toString()) : undefined,
        remainingAmount: Number.parseFloat(existingPlan.remainingAmount?.toString() || "0"),
        remainingAmountUsd: existingPlan.remainingAmountUsd ?
          Number.parseFloat(existingPlan.remainingAmountUsd.toString()) : undefined,
        planStatus: ensurePlanStatus(existingPlan.planStatus),
        autoRenew: existingPlan.autoRenew || false,
        remindersSent: existingPlan.remindersSent || 0,
        lastReminderDate: existingPlan.lastReminderDate?.split("T")[0] || undefined,
        currencyPriority: existingPlan.currencyPriority || 1,
        isActive: existingPlan.isActive !== false,
        notes: existingPlan.notes || "",
        internalNotes: existingPlan.internalNotes || "",
        customInstallments: existingPlan.customInstallments as any || undefined,
        paymentMethod: existingPlan.paymentMethod || undefined,
        methodDetail: existingPlan.methodDetail || "",
        isThirdPartyPayment: false,
        thirdPartyContactId: null,
      };

      form.reset(originalPlanData);
      previousCurrencyRef.current = ensureCurrency(existingPlan.currency);
      previousTotalAmountRef.current = Number.parseFloat(existingPlan.totalPlannedAmount?.toString() || "0");
      isFormInitializedRef.current = true;
      setIsEditing(false);
    } else {
      const newDefaultAmount = effectiveRemainingBalance || effectivePledgeAmount;
      const defaultPledgeId = selectedPledgeId || initialPledgeId ||
        (pledgesData?.pledges?.length ? pledgesData.pledges[0].id : 0);

      const safeCurrency = ensureCurrency(effectivePledgeCurrency);
      const { usdAmount, exchangeRate } = calculateUsdAmounts(newDefaultAmount, safeCurrency);

      form.reset({
        pledgeId: defaultPledgeId,
        relationshipId: undefined,
        planName: "",
        frequency: "monthly" as const,
        distributionType: "fixed" as const,
        totalPlannedAmount: newDefaultAmount,
        currency: safeCurrency,
        totalPlannedAmountUsd: usdAmount,
        installmentAmount: 0,
        installmentAmountUsd: undefined,
        numberOfInstallments: 12,
        exchangeRate: exchangeRate,
        startDate: new Date().toISOString().split("T")[0],
        endDate: "",
        nextPaymentDate: "",
        installmentsPaid: 0,
        totalPaid: 0,
        totalPaidUsd: undefined,
        remainingAmount: newDefaultAmount,
        remainingAmountUsd: usdAmount,
        planStatus: "active" as const,
        autoRenew: false,
        remindersSent: 0,
        lastReminderDate: undefined,
        currencyPriority: 1,
        isActive: true,
        notes: "",
        internalNotes: "",
        customInstallments: undefined,
        paymentMethod: undefined,
        methodDetail: "",
        isThirdPartyPayment: false,
        thirdPartyContactId: null,
      });

      previousCurrencyRef.current = safeCurrency;
      previousTotalAmountRef.current = newDefaultAmount;
      setTimeout(() => {
        isFormInitializedRef.current = true;
      }, 100);
    }
  };
  // Third-party contact search
  const watchedIsThirdParty = form.watch("isThirdPartyPayment");
  const { data: contactsData, isLoading: isLoadingContacts } = useContacts(
    watchedIsThirdParty ? contactSearch : undefined
  );

  const contactIdForPledges = useMemo(() => {
    if (watchedIsThirdParty) {
      // For third-party payments, load pledges for the selected third-party contact
      return selectedThirdPartyContact?.id;
    } else {
      // For regular payments, use the pledge owner contact ID
      // In edit mode, ensure we have the contact ID from the pledge data
      if (isEditMode && pledgeData?.contact?.id) {
        return pledgeData.contact.id;
      }
      return pledgeOwnerContactId;
    }
  }, [watchedIsThirdParty, selectedThirdPartyContact?.id, pledgeOwnerContactId, isEditMode, pledgeData?.contact?.id]);

  const { data: pledgesData, isLoading: isLoadingPledges } = usePledgesQuery({
    page: 1,
    limit: 100,
    contactId: contactIdForPledges ?? undefined,
  }, {
    enabled: !!contactIdForPledges || (watchedIsThirdParty && !selectedThirdPartyContact)
  });


  useEffect(() => {
    if (
      !isEditMode &&
      !initialPledgeId &&
      !selectedPledgeId &&
      pledgesData?.pledges?.length
    ) {
      const firstPledge = pledgesData.pledges[0];
      setSelectedPledgeId(firstPledge.id);
    }
  }, [pledgesData, isEditMode, initialPledgeId, selectedPledgeId]);

  // Contact options for dropdown
  const contactOptions = useMemo(() => {
    if (!contactsData?.contacts) return [];

    return contactsData.contacts.map((contact: Contact) => ({
      label: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(),
      value: contact.id,
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(),
    }));
  }, [contactsData?.contacts]);

  const onSubmit = async (data: PaymentPlanFormData) => {
    try {
      setSubmitError("");

      // Ensure all required fields have proper defaults
      const normalizedData = {
        ...data,
        installmentsPaid: data.installmentsPaid ?? 0,
        totalPaid: data.totalPaid ?? 0,
        remindersSent: data.remindersSent ?? 0,
        currencyPriority: data.currencyPriority ?? 1,
        isActive: data.isActive ?? true,
        currency: data.currency || "USD",
      };

      if (!normalizedData.paymentMethod) {
        setSubmitError("Payment method is required. Please select a payment method.");
        return;
      }

      // Explicit validation check
      const validationResult = paymentPlanSchema.safeParse(normalizedData);

      if (!validationResult.success) {
        console.error("Validation errors:", validationResult.error.errors);

        // Find payment method errors specifically
        const paymentMethodError = validationResult.error.errors.find(e => e.path.includes('paymentMethod'));

        if (paymentMethodError) {
          setSubmitError("Payment method is required. Please select a payment method.");
          return;
        }

        // Set the first validation error as submit error
        const firstError = validationResult.error.errors[0];
        setSubmitError(`${firstError.path.join('.')}: ${firstError.message}`);
        return;
      }

      if (!isEditMode && !showPreview) {
        setShowPreview(true);
        return;
      }

      // Auto-convert to custom if installments were modified in edit mode
      const finalData = { ...normalizedData };
      if (isEditMode && normalizedData.distributionType === "fixed" && installmentsModified) {
        finalData.distributionType = "custom";
        // Recalculate totals based on custom installments
        const totalFromInstallments = normalizedData.customInstallments?.reduce((sum, inst) => sum + inst.installmentAmount, 0) || 0;
        finalData.totalPlannedAmount = roundToPrecision(totalFromInstallments, 2);
        finalData.numberOfInstallments = normalizedData.customInstallments?.length || 0;

        // Update USD amounts
        const safeCurrency = ensureCurrency(finalData.currency);
        const { usdAmount } = calculateUsdAmounts(finalData.totalPlannedAmount, safeCurrency);
        finalData.totalPlannedAmountUsd = usdAmount;
      }

      // Calculate USD amounts if not already set
      if (!finalData.totalPlannedAmountUsd) {
        const safeCurrency = ensureCurrency(finalData.currency);
        const { usdAmount, exchangeRate } = calculateUsdAmounts(finalData.totalPlannedAmount, safeCurrency);
        finalData.totalPlannedAmountUsd = usdAmount;
        finalData.exchangeRate = exchangeRate;
      }

      if (!finalData.installmentAmountUsd) {
        const safeCurrency = ensureCurrency(finalData.currency);
        const { usdAmount } = calculateUsdAmounts(finalData.installmentAmount, safeCurrency);
        finalData.installmentAmountUsd = usdAmount;
      }

      // Transform custom installments for API (ensure all required fields are present)
      const submissionData = {
        ...finalData,
        methodDetail: finalData.methodDetail || "",
        // Third-party payment handling
        isThirdPartyPayment: finalData.isThirdPartyPayment || false,
        thirdPartyContactId: selectedThirdPartyContact?.id || null,
        payerContactId: finalData.isThirdPartyPayment ? contactId : undefined,
        customInstallments: finalData.customInstallments?.map(inst => ({
          installmentDate: inst.installmentDate,
          installmentAmount: inst.installmentAmount,
          currency: inst.currency,
          installmentAmountUsd: inst.installmentAmountUsd ?? undefined,
          status: inst.status,
          paidDate: inst.paidDate ?? undefined,
          notes: inst.notes ?? undefined,
          paymentId: inst.paymentId ?? undefined,
        })),
      };

      if (isEditMode && paymentPlanId) {
        await updatePaymentPlanMutation.mutateAsync({
          id: paymentPlanId,
          data: submissionData,
        });
      } else {
        await createPaymentPlanMutation.mutateAsync(submissionData);
      }

      setOpen(false);
      onSuccess?.();
    } catch (error) {
      console.error(`Error ${isEditMode ? "updating" : "creating"} payment plan:`, error);
      setSubmitError(error instanceof Error ? error.message : "An unexpected error occurred. Please try again.");
    }
  };

  const handlePreviewConfirm = () => {
    const formData = form.getValues();

    // Ensure currency is set (should always be true due to form validation)
    if (!formData.currency) {
      form.setError('currency', { message: 'Currency is required' });
      return;
    }

    setShowPreview(false);
    onSubmit(formData as PaymentPlanFormData);
  };

  const handlePreviewEdit = () => {
    setShowPreview(false);
  };

  useEffect(() => {
    if (isEditMode && existingPlan && isFormInitializedRef.current) {
      const totalAmount = Number.parseFloat(existingPlan.totalPlannedAmount?.toString() || "0");
      const installmentAmount = Number.parseFloat(existingPlan.installmentAmount?.toString() || "0");
      const numberOfInstallments = existingPlan.numberOfInstallments || 1;

      const autoCalculatedAmount = roundToPrecision(totalAmount / numberOfInstallments, 2);
      const difference = Math.abs(installmentAmount - autoCalculatedAmount);

      if (difference > 0.01) {
        setManualInstallment(true);
      }
    }
  }, [existingPlan, isEditMode]);

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      setIsEditing(mode === 'create')
      setManualInstallment(false)
      setShowPreview(false)
      setInstallmentsModified(false)
      setSubmitError('')
      setContactSearch('')

      // Only reset third-party contact if not in edit mode or if it's not a third-party payment
      if (!isEditMode || !(existingPlan as any)?.isThirdPartyPayment) {
        setSelectedThirdPartyContact(null)
      }

      // Don't reset form initialization flag in edit mode
      if (!isEditMode) {
        isFormInitializedRef.current = false
      }

      previousCurrencyRef.current = undefined
      previousTotalAmountRef.current = undefined

      // Reset dropdown states
      setPaymentMethodOpen(false)
      setMethodDetailOpen(false)
      setPledgeSelectorOpen(false)
      onClose?.()
    } else {
      setIsEditing(true)
    }
  }


  const handlePauseResume = (action: "pause" | "resume") => {
    if (existingPlan) {
      pauseResumeMutation.mutate({ planId: existingPlan.id, action });
    }
  };

  const handleDelete = () => {
    if (existingPlan) {
      deleteMutation.mutate(existingPlan.id, {
        onSuccess: () => {
          setOpen(false);
          onSuccess?.();
        },
      });
    }
  };

  const toggleManualInstallment = () => {
    setManualInstallment(!manualInstallment);

    if (!manualInstallment) {
      // When switching to manual mode, keep current values
    } else {
      // When switching back to auto mode, recalculate with precision
      const totalAmount = form.getValues("totalPlannedAmount");
      const installments = form.getValues("numberOfInstallments");

      if (totalAmount && installments > 0) {
        const baseAmount = roundToPrecision(totalAmount / installments, 2);
        const calculatedTotal = baseAmount * installments;
        const difference = roundToPrecision(totalAmount - calculatedTotal, 2);

        let finalAmount = baseAmount;
        if (Math.abs(difference) > 0.01) {
          finalAmount = roundToPrecision(baseAmount + (difference / installments), 2);
        }

        form.setValue("installmentAmount", finalAmount);

        // Update USD amount
        const safeCurrency = ensureCurrency(watchedCurrency);
        const { usdAmount } = calculateUsdAmounts(finalAmount, safeCurrency);
        form.setValue("installmentAmountUsd", usdAmount);
      }
    }
  };

  const pledgeOptions =
    pledgesData?.pledges?.map((pledge) => ({
      label: `#${pledge.id} - ${pledge.description || "No description"} (${pledge.currency
        } ${Number.parseFloat(pledge.unscheduledAmount || pledge.balance.toString()).toLocaleString()})`,
      value: pledge.id,
      balance: Number.parseFloat(pledge.balance.toString()),
      unscheduledAmount: Number.parseFloat(pledge.unscheduledAmount || pledge.balance.toString()),
      currency: pledge.currency,
      description: pledge.description,
    })) || [];

  const defaultTrigger = isEditMode ? (
    <Button size="sm" variant="outline">
      <Edit className="w-4 h-4 mr-2" />
      Edit Plan
    </Button>
  ) : (
    <Button
      size="sm"
      variant="outline"
      className="border-dashed bg-transparent"
    >
      <CalendarIcon className="w-4 h-4 mr-2" />
      Create Payment Plan
    </Button>
  );

  // Determine if pledge selector should be shown
  const shouldShowPledgeSelector = (!isEditMode && showPledgeSelector) || (isEditMode && enablePledgeSelectorInEdit);

  if (isEditMode && (isLoadingPlan || (!existingPlanData && !pledgeDataId))) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
        <span className="ml-2">Loading...</span>
      </div>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEditMode ? "Edit Payment Plan" : "Create Payment Plan"}
          </DialogTitle>
          <DialogDescription>
            {isLoadingPledge ? (
              "Loading pledge details..."
            ) : (
              <div>
                {(() => {
                  // Determine if this is a third-party payment plan (either new or existing)
                  const isThirdPartyPlan = watchedIsThirdParty || (isEditMode && existingPlan && (existingPlan as any).isThirdPartyPayment);

                  if (isThirdPartyPlan) {
                    // Third-party payment plan
                    const beneficiaryContact = isEditMode && existingPlan
                      ? (existingPlan as any).pledgeContactName || (existingPlan as any).pledgeContact
                      : selectedThirdPartyContact?.fullName || "Loading...";

                    const payerContact = isEditMode && existingPlan
                      ? (existingPlan as any).payerContactName
                      : contactId ? "You" : "Loading...";

                    return (
                      <div>
                        {isEditMode ? "Update third-party payment plan" : "Create third-party payment plan"}
                        <span className="block mt-1 text-sm text-muted-foreground">
                          {payerContact} will pay for {beneficiaryContact}&apos;s pledge
                        </span>
                        <span className="block mt-1 text-sm text-muted-foreground">
                          Pledge: {effectivePledgeDescription}
                        </span>
                        {effectiveRemainingBalance > 0 && (
                          <span className="block mt-1 text-sm text-muted-foreground">
                            Remaining Balance: {effectivePledgeCurrency}{" "}
                            {effectiveRemainingBalance.toLocaleString()}
                          </span>
                        )}
                      </div>
                    );
                  } else {
                    // Regular payment plan
                    return (
                      <div>
                        {isEditMode ? "Update the payment plan" : "Set up a"} payment
                        plan for pledge: {effectivePledgeDescription}
                        {effectiveRemainingBalance > 0 && (
                          <span className="block mt-1 text-sm text-muted-foreground">
                            Remaining Balance: {effectivePledgeCurrency}{" "}
                            {effectiveRemainingBalance.toLocaleString()}
                          </span>
                        )}
                        {(pledgeData?.contact || existingPlan) && (
                          <span className="block mt-1 text-sm text-muted-foreground">
                            Contact: {pledgeData?.contact?.fullName || existingPlan?.pledgeContact || "Loading..."}
                          </span>
                        )}
                      </div>
                    );
                  }
                })()}
                <div className="mt-2">
                  <ExchangeRateDisplay
                    currency={effectivePledgeCurrency}
                    exchangeRates={exchangeRates}
                    isLoading={isLoadingRates}
                  />
                </div>
              </div>
            )}
          </DialogDescription>
        </DialogHeader>

        {showPreview ? (
          <PaymentPlanPreview
            formData={{
              ...form.getValues(),
              // Ensure all required fields have proper defaults
              currency: form.getValues().currency || "USD",
              distributionType: form.getValues().distributionType || "fixed",
              autoRenew: form.getValues().autoRenew || false,
              pledgeId: form.getValues().pledgeId || 0,
              totalPlannedAmount: form.getValues().totalPlannedAmount || 0,
              installmentAmount: form.getValues().installmentAmount || 0,
              numberOfInstallments: form.getValues().numberOfInstallments || 1,
              startDate: form.getValues().startDate || new Date().toISOString().split('T')[0],
              planStatus: form.getValues().planStatus || 'active',
              frequency: form.getValues().frequency || 'monthly',
              paymentMethod: form.getValues().paymentMethod!,
              methodDetail: form.getValues().methodDetail || '',
              // Add missing required fields with defaults
              installmentsPaid: form.getValues().installmentsPaid || 0,
              totalPaid: form.getValues().totalPaid || 0,
              remindersSent: form.getValues().remindersSent || 0,
              currencyPriority: form.getValues().currencyPriority || 1,
              isActive: form.getValues().isActive ?? true,
              // Handle custom installments with proper typing
              customInstallments: form.getValues().customInstallments?.map(inst => ({
                ...inst,
                currency: inst.currency || form.getValues().currency || "USD",
                status: inst.status || "pending",
                notes: inst.notes || "",
              })),
            }}
            onConfirm={handlePreviewConfirm}
            onEdit={handlePreviewEdit}
            isLoading={createPaymentPlanMutation.isPending}
            isEditMode={isEditMode}
            installmentsModified={installmentsModified}
            exchangeRates={exchangeRates}
          />
        ) : (
          <>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                {/* Third-Party Payment Section */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <UserPlus className="h-5 w-5" />
                      Payment Type
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      {/* Third-Party Toggle */}
                      <div className="flex items-center space-x-2">
                        <Switch
                          id="isThirdPartyPayment"
                          checked={watchedIsThirdParty}
                          onCheckedChange={handleThirdPartyToggle}
                        />
                        <label
                          htmlFor="isThirdPartyPayment"
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                        >
                          Third-Party Payment (Pay for someone else&apos;s pledge)
                        </label>
                      </div>

                      {/* Contact Search Section */}
                      {watchedIsThirdParty && (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-sm font-medium">Search for Contact</label>
                            <div className="relative">
                              <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                              <Input
                                placeholder="Type to search contacts..."
                                value={contactSearch}
                                onChange={(e) => setContactSearch(e.target.value)}
                                className="pl-10"
                              />
                            </div>
                          </div>

                          {/* Contact Search Results */}
                          {contactSearch.length >= 2 && (
                            <div className="border rounded-md max-h-40 overflow-y-auto">
                              {isLoadingContacts ? (
                                <div className="p-3 text-center text-gray-500">Loading contacts...</div>
                              ) : contactOptions.length > 0 ? (
                                contactOptions.map((contact, index) => (
                                  <button
                                    key={`contact-${contact.value}-${index}`}
                                    type="button"
                                    className="w-full p-3 text-left hover:bg-gray-50 border-b last:border-b-0"
                                    onClick={() => handleContactSelect(contact)}
                                  >
                                    <div className="font-medium">{contact.label}</div>
                                  </button>
                                ))
                              ) : (
                                <div className="p-3 text-center text-gray-500">No contacts found</div>
                              )}
                            </div>
                          )}

                          {/* Selected Contact Display */}
                          {selectedThirdPartyContact && (
                            <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium text-blue-900">
                                    Selected Contact: {selectedThirdPartyContact.fullName}
                                  </div>
                                  <div className="text-sm text-blue-700">
                                    Payment plan will be created for this contact&apos;s pledge
                                  </div>
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedThirdPartyContact(null);
                                    form.setValue("thirdPartyContactId", null);
                                  }}
                                >
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Pledge Selection Card */}
                {shouldShowPledgeSelector && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">
                        Pledges Selection
                      </CardTitle>
                      <CardDescription>
                        {watchedIsThirdParty && selectedThirdPartyContact ? (
                          <>Choose a Pledges from {selectedThirdPartyContact.fullName}&apos;s account</>
                        ) : isEditMode ? (
                          "Change the Pledges for this payment plan"
                        ) : (
                          "Choose the Pledges for this payment plan"
                        )}
                        <br />
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <FormField
                        control={form.control}
                        name="pledgeId"
                        render={({ field }) => (
                          <FormItem className="flex flex-col">
                            <FormLabel>Select Pledges *</FormLabel>
                            <Popover open={pledgeSelectorOpen} onOpenChange={setPledgeSelectorOpen}>
                              <PopoverTrigger asChild>
                                <FormControl>
                                  <Button
                                    variant="outline"
                                    role="combobox"
                                    aria-expanded={pledgeSelectorOpen}
                                    className={cn(
                                      "w-full justify-between",
                                      !field.value && "text-muted-foreground"
                                    )}
                                    disabled={isLoadingPledges}
                                  >
                                    {field.value
                                      ? pledgeOptions.find((p) => p.value === field.value)?.label
                                      : isLoadingPledges
                                        ? "Loading pledges..."
                                        : "Select pledge"}
                                    <ChevronsUpDown className="opacity-50 ml-2" />
                                  </Button>
                                </FormControl>
                              </PopoverTrigger>
                              <PopoverContent className="w-full p-0" align="start">
                                <Command>
                                  <CommandInput placeholder="Search pledges..." className="h-9" />
                                  <CommandList>
                                    <CommandEmpty>No pledge found.</CommandEmpty>
                                    <CommandGroup>
                                      {pledgeOptions.map((pledge) => (
                                        <CommandItem
                                          key={pledge.value}
                                          value={pledge.value.toString()}
                                          onSelect={() => {
                                            setSelectedPledgeId(pledge.value);
                                            form.setValue("pledgeId", pledge.value);
                                            setPledgeSelectorOpen(false);
                                          }}
                                        >
                                          {pledge.label}
                                          <Check
                                            className={cn(
                                              "ml-auto",
                                              pledge.value === field.value ? "opacity-100" : "opacity-0"
                                            )}
                                          />
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                            <FormMessage className="text-sm text-red-600 mt-1" />
                          </FormItem>
                        )}
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Basic Plan Information Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Plan Information</CardTitle>
                    <CardDescription>Basic details about your payment plan</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="hidden">
                      <FormField
                        control={form.control}
                        name="planName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Plan Name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ""}
                                placeholder="Optional plan name"
                              />
                            </FormControl>
                            <FormMessage className="text-sm text-red-600 mt-1" />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="totalPlannedAmount"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Total Planned Amount *</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                {...field}
                                value={field.value || ""}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  const numValue = value ? Number.parseFloat(value) : 0;
                                  field.onChange(numValue);

                                  // Update USD amount
                                  const safeCurrency = ensureCurrency(watchedCurrency);
                                  const { usdAmount, exchangeRate } = calculateUsdAmounts(numValue, safeCurrency);
                                  form.setValue("totalPlannedAmountUsd", usdAmount);
                                  form.setValue("exchangeRate", exchangeRate);
                                }}
                                disabled={!isEditing}
                              />
                            </FormControl>
                            <FormMessage className="text-sm text-red-600 mt-1" />
                            {form.watch("totalPlannedAmountUsd") && watchedCurrency !== "USD" && (
                              <p className="text-xs text-muted-foreground mt-1">
                                USD Equivalent: ${form.watch("totalPlannedAmountUsd")?.toLocaleString()}
                              </p>
                            )}
                          </FormItem>
                        )}
                      />
                      <div className="hidden">
                        <FormField
                          control={form.control}
                          name="currency"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Currency *</FormLabel>
                              <FormControl>
                                <Input
                                  {...field}
                                  value="USD"
                                  disabled
                                  readOnly
                                />
                              </FormControl>
                              <FormMessage className="text-sm text-red-600 mt-1" />
                            </FormItem>
                          )}
                        />
                      </div>
                    </div>
                    <FormField
                      control={form.control}
                      name="frequency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Payment Frequency *</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select frequency" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {frequencies.map((freq) => (
                                <SelectItem key={freq.value} value={freq.value}>
                                  {freq.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-sm text-red-600 mt-1" />
                        </FormItem>
                      )}
                    />

                    {isEditMode && (
                      <FormField
                        control={form.control}
                        name="planStatus"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Plan Status</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value || ""}>
                              <FormControl>
                                <SelectTrigger>
                                  <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                {statusOptions.map((status) => (
                                  <SelectItem key={status.value} value={status.value}>
                                    {status.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage className="text-sm text-red-600 mt-1" />
                          </FormItem>
                        )}
                      />
                    )}
                  </CardContent>
                </Card>

                {/* Payment Method Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Payment Method</CardTitle>
                    <CardDescription>How payments will be processed</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="paymentMethod"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Payment Method *</FormLabel>
                          <Popover open={paymentMethodOpen} onOpenChange={setPaymentMethodOpen}>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  aria-expanded={paymentMethodOpen}
                                  disabled={isLoadingPaymentMethods}
                                  className={cn(
                                    "w-full justify-between",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {isLoadingPaymentMethods ? (
                                    "Loading payment methods..."
                                  ) : field.value ? (
                                    paymentMethodOptions.find(
                                      (method) => method.value === field.value
                                    )?.label || field.value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                                  ) : (
                                    "Select payment method"
                                  )}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0" align="start">
                              <Command shouldFilter={true}>
                                <CommandInput placeholder="Search payment methods..." />
                                <CommandEmpty>No payment method found.</CommandEmpty>
                                <CommandList className="max-h-[300px] overflow-y-auto">
                                  <CommandGroup>
                                    {paymentMethodOptions.map((method, index) => (
                                      <CommandItem
                                        key={`payment-method-${method.value}-${index}`}
                                        value={method.value}
                                        onSelect={(value) => {
                                          const selectedMethod = paymentMethodOptions.find(
                                            m => m.value === value
                                          );
                                          if (selectedMethod) {
                                            form.setValue("paymentMethod", selectedMethod.value);
                                            form.setValue("methodDetail", "");
                                            setPaymentMethodOpen(false);
                                          }
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            method.value === field.value
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                        {method.label}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          <FormMessage className="text-sm text-red-600 mt-1" />
                        </FormItem>
                      )}
                    />
                    <div className="hidden">
                    <FormField
                      control={form.control}
                      name="methodDetail"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Method Detail</FormLabel>
                          <Popover open={methodDetailOpen} onOpenChange={setMethodDetailOpen}>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  aria-expanded={methodDetailOpen}
                                  disabled={!watchedPaymentMethodRef.current || isLoadingDetailOptions}
                                  className={cn(
                                    "w-full justify-between",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {!watchedPaymentMethodRef.current ? (
                                    "Select payment method first"
                                  ) : isLoadingDetailOptions ? (
                                    "Loading details..."
                                  ) : field.value ? (
                                    methodDetailOptions.find(
                                      (detail) => detail.value === field.value
                                    )?.label || field.value.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                                  ) : (
                                    "Select method detail"
                                  )}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0" align="start">
                              <Command shouldFilter={true}>
                                <CommandInput placeholder="Search method details..." />
                                <CommandEmpty>
                                  {methodDetailOptions.length === 0
                                    ? "No method details available for this payment method."
                                    : "No method detail found."}
                                </CommandEmpty>
                                <CommandList className="max-h-[300px] overflow-y-auto">
                                  <CommandGroup>
                                    {methodDetailOptions.map((detail, index) => (
                                      <CommandItem
                                        key={`method-detail-${detail.value}-${index}`}
                                        value={detail.value}
                                        onSelect={(value) => {
                                          const selectedDetail = methodDetailOptions.find(
                                            d => d.value === value
                                          );
                                          if (selectedDetail) {
                                            form.setValue("methodDetail", selectedDetail.value);
                                            setMethodDetailOpen(false);
                                          }
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            detail.value === field.value
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                        {detail.label}
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                          <FormMessage className="text-sm text-red-600 mt-1" />
                        </FormItem>
                      )}
                    />
                    </div>
                  </CardContent>
                </Card>

                {/* Distribution Type Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Payment Distribution</CardTitle>
                    <CardDescription>How payments will be scheduled and distributed</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <FormField
                      control={form.control}
                      name="distributionType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Distribution Type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || "fixed"}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select distribution type" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="fixed">Fixed Amount</SelectItem>
                              <SelectItem value="custom">Custom Schedule</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-sm text-red-600 mt-1" />
                        </FormItem>
                      )}
                    />

                    {/* Show installment editor in edit mode OR when custom is selected */}
                    {(form.watch("distributionType") === "custom" || isEditMode) && (
                      <Card className="border-dashed">
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">
                              {isEditMode && form.watch("distributionType") === "fixed"
                                ? "Edit Installments (will convert to custom plan)"
                                : "Custom Installments"}
                            </CardTitle>
                            {/* Add regenerate button for easy installment refresh */}
                            {isEditMode && form.watch("customInstallments") && form.watch("customInstallments")!.length > 0 && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={regenerateInstallments}
                                className="ml-2"
                              >
                                <RefreshCw className="w-4 h-4 mr-2" />
                                Regenerate
                              </Button>
                            )}
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          {/* Show warning for fixed plans being converted */}
                          {isEditMode && form.watch("distributionType") === "fixed" && installmentsModified && (
                            <Card className="border-amber-200 bg-amber-50">
                              <CardContent className="p-3">
                                <div className="flex items-center">
                                  <AlertTriangle className="w-4 h-4 text-amber-600 mr-2" />
                                  <span className="text-sm text-amber-700">
                                    Modifying installments will convert this fixed plan to a custom plan upon saving.
                                  </span>
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Show info when installments are auto-updated */}
                          {isEditMode && installmentsModified && (
                            <Card className="border-blue-200 bg-blue-50">
                              <CardContent className="p-3">
                                <div className="flex items-center">
                                  <RefreshCw className="w-4 h-4 text-blue-600 mr-2" />
                                  <span className="text-sm text-blue-700">
                                    Installments have been automatically updated to match the new amount and currency.
                                  </span>
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Schedule Summary */}
                          {(form.watch("customInstallments") || []).length > 0 && (
                            <Card className="border-blue-200 bg-blue-50">
                              <CardHeader className="pb-2">
                                <CardTitle className="text-sm text-blue-900">
                                  {isEditMode && form.watch("distributionType") === "fixed" ? "Generated" : "Custom"} Schedule Summary
                                </CardTitle>
                              </CardHeader>
                              <CardContent className="text-sm text-blue-800">
                                <div>Total Installments: {form.watch("customInstallments")?.length || 0}</div>
                                <div>
                                  Total Amount: {form.watch("currency")} {
                                    roundToPrecision(form.watch("customInstallments")?.reduce((sum, inst) => sum + (inst.installmentAmount || 0), 0) || 0, 2).toLocaleString()
                                  }
                                </div>
                              </CardContent>
                            </Card>
                          )}

                          {/* Installments list */}
                          {form.watch("customInstallments")?.map((installment, index) => (
                            <Card key={index} className="bg-gray-50">
                              <CardContent className="p-4">
                                <div className="grid grid-cols-3 gap-4 items-end">
                                  <FormField
                                    control={form.control}
                                    name={`customInstallments.${index}.installmentDate`}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Date</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="date"
                                            {...field}
                                            onChange={(e) => {
                                              const value = e.target.value;
                                              field.onChange(value);
                                              if (isEditMode) {
                                                setInstallmentsModified(true);
                                              }
                                            }}
                                          />
                                        </FormControl>
                                        <FormMessage className="text-sm text-red-600 mt-1" />
                                      </FormItem>
                                    )}
                                  />

                                  <FormField
                                    control={form.control}
                                    name={`customInstallments.${index}.installmentAmount`}
                                    render={({ field }) => (
                                      <FormItem>
                                        <FormLabel>Amount</FormLabel>
                                        <FormControl>
                                          <Input
                                            type="number"
                                            step="0.01"
                                            {...field}
                                            value={field.value || ""}
                                            onChange={(e) => {
                                              const value = e.target.value;
                                              const numValue = value ? Number.parseFloat(value) : 0;
                                              field.onChange(numValue);

                                              // Update USD amount
                                              const safeCurrency = ensureCurrency(watchedCurrency);
                                              const { usdAmount } = calculateUsdAmounts(numValue, safeCurrency);
                                              form.setValue(`customInstallments.${index}.installmentAmountUsd`, usdAmount);

                                              if (isEditMode) {
                                                setInstallmentsModified(true);
                                              }
                                            }}
                                          />
                                        </FormControl>
                                        <FormMessage className="text-sm text-red-600 mt-1" />
                                      </FormItem>
                                    )}
                                  />

                                  <div className="flex items-end space-x-2">
                                    <FormField
                                      control={form.control}
                                      name={`customInstallments.${index}.notes`}
                                      render={({ field }) => (
                                        <FormItem className="flex-1">
                                          <FormLabel>Notes (Optional)</FormLabel>
                                          <FormControl>
                                            <Input
                                              {...field}
                                              value={field.value || ""}
                                              placeholder="Optional notes"
                                              onChange={(e) => {
                                                field.onChange(e.target.value);
                                                if (isEditMode) {
                                                  setInstallmentsModified(true);
                                                }
                                              }}
                                            />
                                          </FormControl>
                                          <FormMessage className="text-sm text-red-600 mt-1" />
                                        </FormItem>
                                      )}
                                    />

                                    <Button
                                      type="button"
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        const currentInstallments = form.getValues("customInstallments") || [];
                                        const newInstallments = currentInstallments.filter((_, i) => i !== index);
                                        form.setValue("customInstallments", newInstallments);

                                        if (isEditMode) {
                                          setInstallmentsModified(true);
                                        }
                                      }}
                                      disabled={(form.watch("customInstallments")?.length || 0) <= 1}
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </Button>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          ))}

                          {/* Add installment button */}
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              const currentInstallments = form.getValues("customInstallments") || [];
                              const lastDate = currentInstallments.length > 0
                                ? currentInstallments[currentInstallments.length - 1].installmentDate
                                : form.getValues("startDate");

                              const nextDate = new Date(lastDate);
                              const frequency = form.getValues("frequency");

                              switch (frequency) {
                                case "weekly":
                                  nextDate.setDate(nextDate.getDate() + 7);
                                  break;
                                case "monthly":
                                  nextDate.setMonth(nextDate.getMonth() + 1);
                                  break;
                                case "quarterly":
                                  nextDate.setMonth(nextDate.getMonth() + 3);
                                  break;
                                case "biannual":
                                  nextDate.setMonth(nextDate.getMonth() + 6);
                                  break;
                                case "annual":
                                  nextDate.setFullYear(nextDate.getFullYear() + 1);
                                  break;
                                default:
                                  nextDate.setMonth(nextDate.getMonth() + 1);
                              }

                              const defaultAmount = form.getValues("installmentAmount") ||
                                roundToPrecision(form.getValues("totalPlannedAmount") / 12, 2);
                              const safeCurrency = ensureCurrency(watchedCurrency);
                              const { usdAmount } = calculateUsdAmounts(defaultAmount, safeCurrency);

                              const newInstallment = {
                                installmentDate: nextDate.toISOString().split("T")[0],
                                installmentAmount: defaultAmount,
                                currency: safeCurrency,
                                installmentAmountUsd: usdAmount,
                                status: "pending" as const,
                                paidDate: undefined,
                                notes: undefined,
                                paymentId: undefined,
                              };

                              form.setValue("customInstallments", [...currentInstallments, newInstallment]);

                              if (isEditMode) {
                                setInstallmentsModified(true);
                              }
                            }}
                            className="w-full"
                          >
                            Add Installment
                          </Button>
                        </CardContent>
                      </Card>
                    )}

                    {/* Fixed distribution settings */}
                    {form.watch("distributionType") === "fixed" && !isEditMode && (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <FormField
                            control={form.control}
                            name="numberOfInstallments"
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Number of Installments *</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    min="1"
                                    {...field}
                                    value={field.value || ""}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      const numValue = value ? Number.parseInt(value, 10) : 0;
                                      field.onChange(numValue);
                                    }}
                                    disabled={!isEditing || manualInstallment}
                                  />
                                </FormControl>
                                <FormMessage className="text-sm text-red-600 mt-1" />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name="installmentAmount"
                            render={({ field }) => (
                              <FormItem>
                                <div className="flex items-center justify-between">
                                  <FormLabel>Installment Amount *</FormLabel>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={toggleManualInstallment}
                                    className="h-auto p-1 text-xs"
                                  >
                                    <Calculator className="w-3 h-3 mr-1" />
                                    {manualInstallment ? "Auto" : "Manual"}
                                  </Button>
                                </div>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    {...field}
                                    value={field.value || ""}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      const numValue = value ? Number.parseFloat(value) : 0;
                                      field.onChange(numValue);

                                      // Update USD amount
                                      const safeCurrency = ensureCurrency(watchedCurrency);
                                      const { usdAmount } = calculateUsdAmounts(numValue, safeCurrency);
                                      form.setValue("installmentAmountUsd", usdAmount);
                                    }}
                                    disabled={!isEditing || !manualInstallment}
                                  />
                                </FormControl>
                                <FormMessage className="text-sm text-red-600 mt-1" />
                                {form.watch("installmentAmountUsd") && watchedCurrency !== "USD" && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    USD Equivalent: ${form.watch("installmentAmountUsd")?.toLocaleString()}
                                  </p>
                                )}
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* Calculation summary for fixed plans */}
                        {watchedTotalPlannedAmount > 0 && watchedNumberOfInstallments > 0 && (
                          <Card className="border-green-200 bg-green-50">
                            <CardContent className="p-3">
                              <div className="text-sm text-green-800">
                                <div className="font-medium">Payment Summary:</div>
                                <div>
                                  {watchedNumberOfInstallments} payments of {watchedCurrency} {watchedInstallmentAmount?.toLocaleString()} each
                                </div>
                                <div>
                                  Total: {watchedCurrency} {(watchedInstallmentAmount * watchedNumberOfInstallments).toLocaleString()}
                                </div>
                                {Math.abs((watchedInstallmentAmount * watchedNumberOfInstallments) - watchedTotalPlannedAmount) > 0.01 && (
                                  <div className="text-amber-700 mt-1">
                                    ⚠️ Difference: {watchedCurrency} {Math.abs((watchedInstallmentAmount * watchedNumberOfInstallments) - watchedTotalPlannedAmount).toLocaleString()}
                                  </div>
                                )}
                              </div>
                            </CardContent>
                          </Card>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Schedule Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Schedule Details</CardTitle>
                    <CardDescription>When payments will be made</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="startDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Start Date *</FormLabel>
                            <FormControl>
                              <Input type="date" {...field} disabled={!isEditing} />
                            </FormControl>
                            <FormMessage className="text-sm text-red-600 mt-1" />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="endDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>End Date</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                {...field}
                                value={field.value || ""}
                                disabled={!isEditing}
                                readOnly
                              />
                            </FormControl>
                            <FormMessage className="text-sm text-red-600 mt-1" />
                          </FormItem>
                        )}
                      />
                    </div>

                    {watchedFrequency !== "one_time" && (
                      <FormField
                        control={form.control}
                        name="nextPaymentDate"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Next Payment Date</FormLabel>
                            <FormControl>
                              <Input
                                type="date"
                                {...field}
                                value={field.value || ""}
                                disabled={!isEditing}
                                readOnly
                              />
                            </FormControl>
                            <FormMessage className="text-sm text-red-600 mt-1" />
                          </FormItem>
                        )}
                      />
                    )}
                  </CardContent>
                </Card>

                {/* Options Card */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Additional Options</CardTitle>
                    <CardDescription>Additional settings and notes</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center space-x-2">
                      <FormField
                        control={form.control}
                        name="autoRenew"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                            <FormControl>
                              <Checkbox
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                            <div className="space-y-1 leading-none">
                              <FormLabel>Auto-renew plan when completed</FormLabel>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="notes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Public Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              value={field.value || ""}
                              placeholder="Notes visible to all users"
                              disabled={!isEditing}
                            />
                          </FormControl>
                          <FormMessage className="text-sm text-red-600 mt-1" />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="internalNotes"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Internal Notes</FormLabel>
                          <FormControl>
                            <Textarea
                              {...field}
                              value={field.value || ""}
                              placeholder="Internal notes for admin use only"
                              disabled={!isEditing}
                            />
                          </FormControl>
                          <FormMessage className="text-sm text-red-600 mt-1" />
                        </FormItem>
                      )}
                    />
                  </CardContent>
                </Card>

                {/* Error display */}
                {submitError && (
                  <Card className="border-red-200 bg-red-50">
                    <CardContent className="p-3">
                      <div className="flex items-center">
                        <AlertTriangle className="w-4 h-4 text-red-600 mr-2" />
                        <span className="text-sm text-red-700">{submitError}</span>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Edit Mode: Management Actions */}
                {!isEditing && isEditMode && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Plan Management</CardTitle>
                      <CardDescription>Actions to manage this payment plan</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsEditing(true)}
                          size="sm"
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Edit Plan
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => handlePauseResume(existingPlan?.planStatus === 'paused' ? 'resume' : 'pause')}
                          disabled={pauseResumeMutation.isPending}
                          size="sm"
                        >
                          {existingPlan?.planStatus === 'paused' ? 'Resume' : 'Pause'} Plan
                        </Button>
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={handleDelete}
                          disabled={deleteMutation.isPending}
                          size="sm"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete Plan
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {isEditing && (
                  <div className="flex justify-end space-x-2 pt-4 border-t">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        if (isEditMode) {
                          // Close the entire dialog in edit mode
                          handleOpenChange(false);
                        } else {
                          handleOpenChange(false);
                        }
                      }}
                      disabled={
                        createPaymentPlanMutation.isPending ||
                        updatePaymentPlanMutation.isPending
                      }
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        createPaymentPlanMutation.isPending ||
                        updatePaymentPlanMutation.isPending ||
                        isLoadingPledge ||
                        (!isEditMode && !selectedPledgeId) ||
                        (shouldShowPledgeSelector && isLoadingPledges) ||
                        !form.watch("paymentMethod") ||
                        (watchedIsThirdParty && !selectedThirdPartyContact)
                      }
                      className="text-white"
                    >
                      {createPaymentPlanMutation.isPending ||
                        updatePaymentPlanMutation.isPending
                        ? isEditMode
                          ? "Updating..."
                          : "Creating..."
                        : isEditMode
                          ? "Update Payment Plan"
                          : "Continue to Preview"}
                    </Button>
                  </div>
                )}
              </form>
            </Form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}