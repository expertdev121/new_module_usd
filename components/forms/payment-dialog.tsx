/* eslint-disable @typescript-eslint/no-explicit-any */
// eslint-disable-next-line react-hooks/exhaustive-deps
"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, ChevronsUpDown, X, Plus, Split, Users, Search, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandInput,
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
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import PledgeDialog from "../forms/pledge-form";
import { useExchangeRates } from "@/lib/query/useExchangeRates";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useCreatePaymentMutation } from "@/lib/query/payments/usePaymentQuery";
import { usePledgeDetailsQuery } from "@/lib/query/payment-plans/usePaymentPlanQuery";
import { PlusCircleIcon } from "lucide-react";
import { usePledgesQuery } from "@/lib/query/usePledgeData";
import useContactId from "@/hooks/use-contact-id";
import { useTagsQuery } from "@/lib/query/tags/useTagsQuery";
import { useAccountsQuery } from "@/lib/query/accounts/useAccountsQuery";

import {
  usePaymentMethodOptions,
  usePaymentMethodDetailOptions
} from "@/lib/query/usePaymentMethods";


interface Solicitor {
  id: number;
  firstName: string;
  lastName: string;
  commissionRate: number;
  contact: any;
}

interface Pledge {
  id: number;
  description: string | null;
  currency: string;
  balance: string;
  originalAmount: string;
  remainingBalance?: number;
  contactId?: number;
  contact?: {
    fullName: string;
    id?: number;
  };
}

interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  displayName?: string | null;
  fullName?: string; // Make optional since API may not provide it
}

interface ContactAllocation {
  contactId: number;
  contactName: string;
  pledges: {
    pledgeId: number;
    pledgeDescription: string;
    currency: string;
    balance: number;
    allocatedAmount: number;
    receiptNumber?: string | null;
    receiptType?: string | null;
    receiptIssued?: boolean;
  }[];
}

interface MultiContactAllocation {
  contactId: number;
  pledgeId: number;
  allocatedAmount: number;
  notes: string | null;
  receiptNumber?: string | null;
  receiptType?: string | null;
  receiptIssued?: boolean;
}

interface ContactOption {
  label: string;
  value: number;
  id: number;
  firstName: string;
  lastName: string;
  fullName: string;
}

// ADD TAG INTERFACE
interface Tag {
  id: number;
  name: string;
  description: string | null;
  showOnPayment: boolean;
  showOnPledge: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const useSolicitors = (params: { search?: string; status?: "active" | "inactive" | "suspended" } = {}) =>
  useQuery<{ solicitors: Solicitor[] }>({
    queryKey: ["solicitors", params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.search) searchParams.set("search", params.search);
      if (params.status) searchParams.set("status", params.status);

      const response = await fetch(`/api/solicitor?${searchParams}`);
      if (!response.ok) throw new Error("Failed to fetch solicitors");
      return response.json();
    },
  });

// Updated useContacts hook to handle missing fullName field
const useContacts = (search?: string) =>
  useQuery<{ contacts: Contact[] }>({
    queryKey: ["contacts", search],
    queryFn: async () => {
      if (!search || search.length < 2) return { contacts: [] };
      const response = await fetch(`/api/contacts/search?q=${encodeURIComponent(search)}`);
      if (!response.ok) throw new Error("Failed to fetch contacts");
      const data = await response.json();

      // Transform contacts to ensure fullName is available
      if (data.contacts) {
        data.contacts = data.contacts.map((contact: Contact) => ({
          ...contact,
          fullName: contact.fullName ||
            contact.displayName ||
            `${contact.firstName} ${contact.lastName}`.trim()
        }));
      }

      return data;
    },
    enabled: !!search && search.length >= 2,
  });

const supportedCurrencies = [
  "USD",
  "ILS",
  "EUR",
  "JPY",
  "GBP",
  "AUD",
  "CAD",
  "ZAR",
] as const;

const paymentStatuses = [
  { value: "expected", label: "Expected" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "refund", label: "Refund" },
  { value: "returned", label: "Returned" },
  { value: "declined", label: "Declined" },
] as const;

const receiptTypes = [
  { value: "invoice", label: "Invoice" },
  { value: "confirmation", label: "Confirmation" },
  { value: "receipt", label: "Receipt" },
  { value: "other", label: "Other" },
] as const;

// Allocation schema with receipt fields per allocation
const allocationSchema = z.object({
  pledgeId: z.number().optional(),
  allocatedAmount: z.number().optional(),
  installmentScheduleId: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  receiptNumber: z.string().optional().nullable(),
  receiptType: z.string().optional().nullable(),
  receiptIssued: z.boolean().optional(),
});

// UPDATED Payment schema - ADD TAGS
const paymentSchema = z.object({
  amount: z.number().optional(),
  currency: z.enum(supportedCurrencies).optional(),
  amountUsd: z.number().optional(),
  exchangeRate: z.number().optional(),
  amountInPledgeCurrency: z.number().optional(),
  exchangeRateToPledgeCurrency: z.number().optional(),
  paymentDate: z.string().optional(),
  receivedDate: z.string().optional().nullable(),
  paymentMethod: z.string().optional(),
  methodDetail: z.string().optional().nullable(),
  accountId: z.number().optional().nullable(),
  paymentStatus: z.string().optional(),
  checkDate: z.string().optional().nullable(),
  checkNumber: z.string().optional().nullable(),

  solicitorId: z.number().optional().nullable(),
  bonusPercentage: z.number().optional().nullable(),
  bonusAmount: z.number().optional().nullable(),
  bonusRuleId: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),

  pledgeId: z.number().optional().nullable(),
  paymentPlanId: z.number().optional().nullable(),
  installmentScheduleId: z.number().optional().nullable(),

  // Third-party payment fields
  isThirdPartyPayment: z.boolean().optional(),
  thirdPartyContactId: z.number().optional().nullable(),

  isSplitPayment: z.boolean().optional(),
  isMultiContactPayment: z.boolean().optional(),
  allocations: z.array(allocationSchema).optional(),

  // ADD TAGS TO SCHEMA
  tagIds: z.array(z.number()).optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface PaymentDialogProps {
  pledgeId?: number;
  contactId?: number;
  amount: number;
  currency: string;
  description: string;
  showPledgeSelector?: boolean;
}

export default function PaymentFormDialog({
  pledgeId: initialPledgeId,
  contactId: propContactId,
  showPledgeSelector = false,
}: PaymentDialogProps) {
  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      amount: 0,
      currency: "USD",
      exchangeRate: 1,
      amountUsd: 0,
      amountInPledgeCurrency: 0,
      exchangeRateToPledgeCurrency: 1,
      paymentDate: new Date().toISOString().split("T")[0],
      receivedDate: null,
      paymentMethod: undefined,
      methodDetail: undefined,
      accountId: null,
      checkDate: null,
      checkNumber: null,
      paymentStatus: "completed",
      solicitorId: null,
      bonusPercentage: null,
      bonusAmount: null,
      bonusRuleId: null,
      notes: null,
      pledgeId: initialPledgeId || null,
      paymentPlanId: null,
      installmentScheduleId: null,
      isThirdPartyPayment: false,
      thirdPartyContactId: null,
      isSplitPayment: false,
      isMultiContactPayment: false,
      allocations: initialPledgeId
        ? [
          {
            pledgeId: initialPledgeId,
            allocatedAmount: 0,
            installmentScheduleId: null,
            notes: null,
            receiptNumber: null,
            receiptType: null,
            receiptIssued: false,
          },
        ]
        : [
          {
            pledgeId: 0,
            allocatedAmount: 0,
            installmentScheduleId: null,
            notes: null,
            receiptNumber: null,
            receiptType: null,
            receiptIssued: false,
          },
        ],
      // ADD DEFAULT TAGS
      tagIds: [],
    },
  });
  const { options: paymentMethodOptions, isLoading: isLoadingPaymentMethods } = usePaymentMethodOptions();
  const { data: accountsData, isLoading: isLoadingAccounts } = useAccountsQuery();

  const watchedPaymentMethod = useRef<string | undefined>(undefined);
  const currentPaymentMethod = form.watch("paymentMethod");

  const { options: methodDetailOptions, isLoading: isLoadingDetailOptions } =
    usePaymentMethodDetailOptions(watchedPaymentMethod.current);

  const [paymentMethodOpen, setPaymentMethodOpen] = useState(false);
  const [methodDetailOpen, setMethodDetailOpen] = useState(false);

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "allocations",
  });

  const watchedCurrency = form.watch("currency");
  const watchedAmount = form.watch("amount");
  const watchedPaymentDate = form.watch("paymentDate");
  const watchedReceivedDate = form.watch("receivedDate");
  const watchedSolicitorId = form.watch("solicitorId");
  const watchedBonusPercentage = form.watch("bonusPercentage");
  const watchedExchangeRate = form.watch("exchangeRate");
  const watchedAllocations = form.watch("allocations");
  const watchedIsSplitPayment = form.watch("isSplitPayment");
  const watchedIsMultiContactPayment = form.watch("isMultiContactPayment");
  const watchedMainPledgeId = form.watch("pledgeId");
  const watchedIsThirdParty = form.watch("isThirdPartyPayment");
  // ADD TAG WATCHES
  const watchedTagIds = form.watch('tagIds');

  const { data: solicitorsData, isLoading: isLoadingSolicitors } = useSolicitors({ status: "active" });
  const createPaymentMutation = useCreatePaymentMutation();

  const [open, setOpen] = useState(false);
  const [showSolicitorSection, setShowSolicitorSection] = useState(false);
  const [pledgeDialogOpen, setPledgeDialogOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedThirdPartyContact, setSelectedThirdPartyContact] = useState<Contact | null>(null);
  const [showMultiContactSection, setShowMultiContactSection] = useState(false);
  const [multiContactAllocations, setMultiContactAllocations] = useState<MultiContactAllocation[]>([]);

  // ADD TAG STATE
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);

  // ADD TAGS QUERY - only fetch tags that should show on payments
  const { data: tagsData, isLoading: isLoadingTags } = useTagsQuery({
    showOnPayment: true,
    isActive: true
  });
  const availableTags: Tag[] = tagsData?.tags || [];

  // Multi-contact allocation functions
  const addMultiContactAllocation = (preSelectedContactId?: number) => {
    setMultiContactAllocations([...multiContactAllocations, {
      contactId: preSelectedContactId || 0,
      pledgeId: 0,
      allocatedAmount: 0,
      notes: null,
      receiptNumber: null,
      receiptType: null,
      receiptIssued: false,
    }]);
  };

  const removeMultiContactAllocation = (index: number) => {
    setMultiContactAllocations(multiContactAllocations.filter((_, i) => i !== index));
  };

  const updateMultiContactAllocation = (index: number, field: keyof MultiContactAllocation, value: any) => {
    setMultiContactAllocations(prev =>
      prev.map((allocation, i) =>
        i === index ? { ...allocation, [field]: value } : allocation
      )
    );
  };

  const getTotalMultiContactAllocation = () => {
    return multiContactAllocations.reduce((total, allocation) => {
      return total + allocation.allocatedAmount;
    }, 0);
  };

  // ADD TAG HANDLING FUNCTIONS
  const handleTagToggle = (tagId: number) => {
    const currentTagIds = form.getValues('tagIds') || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter(id => id !== tagId)
      : [...currentTagIds, tagId];

    form.setValue('tagIds', newTagIds, { shouldValidate: true });
    setSelectedTagIds(newTagIds);
  };

  const handleTagRemove = (tagId: number) => {
    const currentTagIds = form.getValues('tagIds') || [];
    const newTagIds = currentTagIds.filter(id => id !== tagId);

    form.setValue('tagIds', newTagIds, { shouldValidate: true });
    setSelectedTagIds(newTagIds);
  };

  // Selected tags for display
  const selectedTags = availableTags.filter(tag =>
    (watchedTagIds?.includes(tag.id) || selectedTagIds.includes(tag.id))
  );

  // Refs to store last valid date values
  const lastValidPaymentDateRef = useRef<string | null>(null);
  const lastValidReceivedDateRef = useRef<string | null>(null);
  const lastValidCheckDateRef = useRef<string | null>(null);

  const contactId = useContactId() || propContactId;

  // Contact data for third-party (only when third-party is enabled and not multi-contact)
  const { data: contactsData, isLoading: isLoadingContacts } = useContacts(
    watchedIsThirdParty && !showMultiContactSection ? contactSearch : undefined
  );

  // Multi-contact allocation contact IDs
  const multiContactIds = useMemo(() => {
    return [...new Set(multiContactAllocations.map(a => a.contactId).filter(id => id > 0))];
  }, [multiContactAllocations]);

  // Get pledges for selected contacts in multi-contact section - Updated to handle fullName
  const { data: allContactsForAllocations } = useQuery({
    queryKey: ['all-contacts-for-multi-contact'],
    queryFn: async () => {
      const response = await fetch(`/api/contacts?limit=100`);
      if (!response.ok) throw new Error('Failed to fetch contacts');
      const data = await response.json();

      // Transform contacts to ensure fullName is available
      if (data.contacts) {
        data.contacts = data.contacts.map((contact: Contact) => ({
          ...contact,
          fullName: contact.fullName ||
            contact.displayName ||
            `${contact.firstName} ${contact.lastName}`.trim()
        }));
      }

      return data.contacts || [];
    },
    enabled: showMultiContactSection,
  });

  // Use a single query for all multi-contact pledges
  const { data: multiContactPledgesData } = useQuery({
    queryKey: ['multi-contact-pledges', multiContactIds],
    queryFn: async () => {
      if (multiContactIds.length === 0) return { pledges: [] };

      const pledgePromises = multiContactIds.map(async (contactId) => {
        const response = await fetch(`/api/pledges?contactId=${contactId}&page=1&limit=100`);
        if (!response.ok) throw new Error('Failed to fetch pledges');
        const data = await response.json();
        return data.pledges || [];
      });

      const results = await Promise.all(pledgePromises);
      const allPledges = results.flat();

      return { pledges: allPledges };
    },
    enabled: multiContactIds.length > 0,
  });

  // Combine all pledges from multi-contacts
  const allPledgesData = useMemo(() => {
    return multiContactPledgesData?.pledges || [];
  }, [multiContactPledgesData]);

  // Get pledges for the current contact or third-party contact
  const targetContactId = selectedThirdPartyContact?.id || contactId;
  const { data: pledgesData, isLoading: isLoadingPledges } = usePledgesQuery(
    {
      contactId: targetContactId as number,
      page: 1,
      limit: 100,
      status: undefined,
    },
    { enabled: !!targetContactId && !watchedIsMultiContactPayment }
  );

  // Get pledge currency for exchange rate display
  const selectedPledgeCurrency = useMemo(() => {
    if (!watchedMainPledgeId || !pledgesData?.pledges) return null;
    const pledge = pledgesData.pledges.find(p => p.id === watchedMainPledgeId);
    return pledge?.currency || null;
  }, [watchedMainPledgeId, pledgesData?.pledges]);

  const {
    data: exchangeRatesData,
    isLoading: isLoadingRates,
    error: ratesError,
    refetch: refetchRates,
  } = useExchangeRates(watchedReceivedDate || undefined);

  const totalAllocatedAmount = (watchedAllocations || []).reduce(
    (sum, alloc) => sum + (alloc.allocatedAmount || 0),
    0
  );
  const remainingToAllocate = (watchedAmount || 0) - totalAllocatedAmount;

  const { data: pledgeData, isLoading: isLoadingPledge } = usePledgeDetailsQuery(
    watchedMainPledgeId!,
    { enabled: !watchedIsSplitPayment && !watchedIsMultiContactPayment && !!watchedMainPledgeId && watchedMainPledgeId !== 0 }
  );

  // Add debugging for pledges data
  useEffect(() => {
    if (pledgesData?.pledges) {
      const ids = pledgesData.pledges.map(p => p.id);
      const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
      if (duplicates.length > 0) {
        console.warn('Duplicate pledge IDs found:', [...new Set(duplicates)]);
        console.log('All pledges:', pledgesData.pledges);
      }
    }
  }, [pledgesData?.pledges]);

  const getExchangeRate = (currency: string): number => {
    if (currency === "USD") return 1;
    const rates = exchangeRatesData?.data?.rates;
    if (rates && rates.hasOwnProperty(currency)) {
      const rate = parseFloat(rates[currency]);
      return isNaN(rate) ? 1 : rate;
    }
    console.warn(`Missing exchange rate for ${currency}, defaulting to 1`);
    return 1;
  };

  // Set exchange rate automatically on currency change
  useEffect(() => {
    if (watchedCurrency && exchangeRatesData?.data?.rates) {
      const autoRate = getExchangeRate(watchedCurrency);
      form.setValue("exchangeRate", autoRate, { shouldValidate: true, shouldDirty: true });
    }
  }, [watchedCurrency, exchangeRatesData, form]);

  // Update amountUsd whenever amount, currency or exchangeRate changes
  useEffect(() => {
    const currency = form.getValues("currency");
    const amount = form.getValues("amount");
    let currentExchangeRate = form.getValues("exchangeRate");
    currentExchangeRate = currentExchangeRate && currentExchangeRate > 0 ? currentExchangeRate : 1;

    if (currency && amount != null) {
      const rate = currency === "USD" ? 1 : currentExchangeRate;
      // Fix conversion: amount in foreign currency divided by rate (ILS per USD) to get USD
      const usdAmount = currency === "USD" ? amount : amount / rate;
      form.setValue("amountUsd", Math.round(usdAmount * 100) / 100, {
        shouldValidate: true,
        shouldDirty: true,
      });
    }
  }, [watchedCurrency, watchedAmount, watchedExchangeRate, form]);

  // Update bonusAmount when bonusPercentage or amount changes
  useEffect(() => {
    if (watchedBonusPercentage != null && watchedAmount != null) {
      const bonusAmount = (watchedAmount * watchedBonusPercentage) / 100;
      form.setValue("bonusAmount", Math.round(bonusAmount * 100) / 100, {
        shouldValidate: true,
        shouldDirty: true,
      });
    } else {
      form.setValue("bonusAmount", null, { shouldValidate: true, shouldDirty: true });
    }
  }, [watchedBonusPercentage, watchedAmount, form]);

  // Calculate pledge exchange rate and amount in pledge currency
  useEffect(() => {
    if (selectedPledgeCurrency && watchedCurrency && exchangeRatesData?.data?.rates) {
      const paymentCurrency = watchedCurrency;
      const pledgeCurrency = selectedPledgeCurrency;

      if (paymentCurrency === pledgeCurrency) {
        // Same currency, exchange rate is 1
        form.setValue("exchangeRateToPledgeCurrency", 1, { shouldValidate: true, shouldDirty: true });
        form.setValue("amountInPledgeCurrency", watchedAmount || 0, { shouldValidate: true, shouldDirty: true });
      } else {
        // Different currencies, calculate exchange rate
        let exchangeRate = 1;

        if (paymentCurrency === "USD") {
          // Payment in USD, pledge in foreign currency
          exchangeRate = getExchangeRate(pledgeCurrency);
        } else if (pledgeCurrency === "USD") {
          // Payment in foreign currency, pledge in USD
          exchangeRate = 1 / getExchangeRate(paymentCurrency);
        } else {
          // Both currencies are foreign, convert through USD
          const paymentToUsdRate = getExchangeRate(paymentCurrency);
          const pledgeToUsdRate = getExchangeRate(pledgeCurrency);
          exchangeRate = pledgeToUsdRate / paymentToUsdRate;
        }

        form.setValue("exchangeRateToPledgeCurrency", Math.round(exchangeRate * 10000) / 10000, {
          shouldValidate: true,
          shouldDirty: true,
        });

        // Calculate amount in pledge currency
        const amountInPledgeCurrency = (watchedAmount || 0) * exchangeRate;
        form.setValue("amountInPledgeCurrency", Math.round(amountInPledgeCurrency * 100) / 100, {
          shouldValidate: true,
          shouldDirty: true,
        });
      }
    } else {
      // No pledge selected or no exchange rates available
      form.setValue("exchangeRateToPledgeCurrency", 1, { shouldValidate: true, shouldDirty: true });
      form.setValue("amountInPledgeCurrency", watchedAmount || 0, { shouldValidate: true, shouldDirty: true });
    }
  }, [selectedPledgeCurrency, watchedCurrency, watchedAmount, exchangeRatesData, form]);

  // ADD SYNC EFFECT FOR TAGS
  useEffect(() => {
    if (watchedTagIds && Array.isArray(watchedTagIds)) {
      setSelectedTagIds(watchedTagIds);
    }
  }, [watchedTagIds]);
  useEffect(() => {
    watchedPaymentMethod.current = currentPaymentMethod;
    // Clear method detail when payment method changes
    if (currentPaymentMethod) {
      form.setValue("methodDetail", "");
    }
  }, [currentPaymentMethod, form]);

  const resetForm = useCallback(() => {
    form.reset({
      amount: 0,
      currency: "USD",
      exchangeRate: 1,
      amountUsd: 0,
      paymentDate: new Date().toISOString().split("T")[0],
      receivedDate: null,
      paymentMethod: "cash",
      methodDetail: undefined,
      accountId: null,
      checkDate: null,
      checkNumber: null,
      paymentStatus: "completed",
      solicitorId: null,
      bonusPercentage: null,
      bonusAmount: null,
      bonusRuleId: null,
      notes: null,
      pledgeId: initialPledgeId || null,
      paymentPlanId: null,
      installmentScheduleId: null,
      isThirdPartyPayment: false,
      thirdPartyContactId: null,
      isSplitPayment: false,
      isMultiContactPayment: false,
      allocations: initialPledgeId
        ? [
          {
            pledgeId: initialPledgeId,
            allocatedAmount: 0,
            installmentScheduleId: null,
            notes: null,
            receiptNumber: null,
            receiptType: null,
            receiptIssued: false,
          },
        ]
        : [
          {
            pledgeId: 0,
            allocatedAmount: 0,
            installmentScheduleId: null,
            notes: null,
            receiptNumber: null,
            receiptType: null,
            receiptIssued: false,
          },
        ],
      // RESET TAGS
      tagIds: [],
    });
    setShowSolicitorSection(false);
    setSelectedThirdPartyContact(null);
    setContactSearch("");
    setMultiContactAllocations([]);
    setShowMultiContactSection(false);
    setPaymentMethodOpen(false);
    setMethodDetailOpen(false);
    setSelectedTagIds([]);
  }, [form, initialPledgeId]);

  const onSubmit = async (data: PaymentFormData) => {
    try {
      // Validate required fields first
      if (!data.amount || data.amount <= 0) {
        throw new Error("Payment amount is required and must be greater than 0");
      }

      if (!data.currency) {
        throw new Error("Currency is required");
      }

      if (!data.paymentStatus) {
        throw new Error("Payment status is required");
      }

      if (!data.paymentDate) {
        throw new Error("Payment date is required");
      }

      const exchangeRateNum = Number(data.exchangeRate) || 1;
      const amountNum = Number(data.amount);
      const amountUsdNum = Number(data.amountUsd) || (amountNum * exchangeRateNum);

      const isSplit = data.isSplitPayment;
      const isMultiContact = watchedIsMultiContactPayment && multiContactAllocations.length > 0;
      // Multi-contact payments are always third-party payments
      const isThirdParty = data.isThirdPartyPayment || isMultiContact;

      // Convert accountId to account name
      let accountName: string | null = null;
      if (data.accountId) {
        const selectedAccount = accountsData?.find(acc => acc.id === data.accountId);
        accountName = selectedAccount?.name || null;
      }

      // Build base payload with correct type assertions
      const basePayload = {
        amount: amountNum,
        currency: data.currency as any,
        amountUsd: amountUsdNum,
        exchangeRate: exchangeRateNum,
        paymentDate: data.paymentDate,
        receivedDate: data.receivedDate || undefined,
        paymentMethod: data.paymentMethod as any,
        methodDetail: data.methodDetail || undefined,
        account: accountName, 
        checkDate: data.checkDate || undefined,
        checkNumber: data.checkNumber || undefined,
        paymentStatus: data.paymentStatus as any,
        solicitorId: data.solicitorId ? Number(data.solicitorId) : undefined,
        bonusPercentage: data.bonusPercentage || undefined,
        bonusAmount: data.bonusAmount || undefined,
        bonusRuleId: data.bonusRuleId || undefined,
        notes: data.notes || undefined,
        isThirdPartyPayment: isThirdParty,
        isMultiContactPayment: isMultiContact,
        payerContactId: isThirdParty ? (contactId || undefined) : undefined,
        thirdPartyContactId: selectedThirdPartyContact?.id || undefined,
        // ADD TAGS TO PAYLOAD
        tagIds: data.tagIds || [],
      };

      if (isMultiContact) {
        // Handle multi-contact payment
        if (getTotalMultiContactAllocation() !== (data.amount || 0)) {
          throw new Error("Multi-contact payment allocation amounts must equal the total payment amount");
        }

        // Validate all allocations have valid data
        const validAllocations = multiContactAllocations.filter(
          allocation => allocation.contactId > 0 && allocation.pledgeId > 0 && allocation.allocatedAmount > 0
        );

        if (validAllocations.length === 0) {
          throw new Error("At least one valid allocation is required for multi-contact payment");
        }

        // For multi-contact payments, we need to determine who is the actual payer
        // This could be:
        // 1. The current user (contactId) - paying for multiple other people's pledges
        // 2. A selected third-party contact - if explicitly selected in the UI
        const actualPayerId = selectedThirdPartyContact?.id || contactId;

        if (!actualPayerId) {
          throw new Error("Unable to determine payer for multi-contact payment");
        }

        // Create a single payment with all allocations
        const multiContactPayload = {
          ...basePayload,
          pledgeId: 0, // Indicates this is a split payment
          payerContactId: actualPayerId, // The person making the payment
          // Convert multi-contact allocations to the format expected by the API
          allocations: validAllocations.map((allocation) => ({
            contactId: Number(allocation.contactId), // The beneficiary contact for each allocation
            pledgeId: Number(allocation.pledgeId),
            installmentScheduleId: null,
            allocatedAmount: Number(allocation.allocatedAmount),
            currency: data.currency,
            notes: allocation.notes,
            receiptNumber: allocation.receiptNumber,
            receiptType: allocation.receiptType,
            receiptIssued: allocation.receiptIssued || false,
          })) as any,
        };

        // Send as a single payment request
        await createPaymentMutation.mutateAsync(multiContactPayload as any);

        toast.success(`Multi-contact payment created successfully with ${validAllocations.length} allocations!`);

      } else if (isSplit) {
        // Handle regular split payment (single contact, multiple pledges)
        if (!data.allocations || data.allocations.length === 0) {
          throw new Error("Split payment requires at least one allocation.");
        }

        // Validate all allocations have valid pledge IDs
        for (const allocation of data.allocations) {
          if (!allocation.pledgeId || allocation.pledgeId === 0) {
            throw new Error("All allocations must have a valid pledge selected.");
          }
          if (!allocation.allocatedAmount || allocation.allocatedAmount <= 0) {
            throw new Error("All allocations must have an amount greater than 0.");
          }
        }

        const paymentPayload = {
          ...basePayload,
          pledgeId: 0,
          // Cast allocations to any to bypass TypeScript checking
          allocations: data.allocations.map((allocation) => ({
            pledgeId: Number(allocation.pledgeId),
            installmentScheduleId: allocation.installmentScheduleId ? Number(allocation.installmentScheduleId) : null,
            allocatedAmount: Number(allocation.allocatedAmount) || 0,
            currency: data.currency, // Add currency from the main payment
            notes: allocation.notes || null,
            receiptNumber: allocation.receiptNumber || null,
            receiptType: allocation.receiptType || null,
            receiptIssued: allocation.receiptIssued || false,
          })) as any, // Type assertion to bypass strict typing
        };

        await createPaymentMutation.mutateAsync(paymentPayload as any);
        toast.success("Split payment created successfully!");

      } else {
        // Handle single payment to single pledge
        if (!data.pledgeId || data.pledgeId === 0) {
          throw new Error("Single payment requires a valid pledge ID.");
        }

        // For single payments, determine the payer
        // If third-party is enabled, use the selected contact or current user
        const actualPayerId = isThirdParty
          ? (contactId)
          : undefined;

        const paymentPayload = {
          ...basePayload,
          pledgeId: Number(data.pledgeId),
          payerContactId: actualPayerId,
          installmentScheduleId: data.allocations?.length === 1 && data.allocations[0].installmentScheduleId
            ? Number(data.allocations[0].installmentScheduleId)
            : null,
        };

        await createPaymentMutation.mutateAsync(paymentPayload as any);

        // Success message for single payment
        const paymentType = isThirdParty ? "Third-party payment" : "Payment";
        const target = selectedThirdPartyContact ? ` for ${selectedThirdPartyContact.fullName}` : "";
        toast.success(`${paymentType}${target} created successfully!`);
      }

      // Reset form and close dialog on success
      resetForm();
      setOpen(false);

    } catch (error) {
      console.error("Error creating payment:", error);
      toast.error(error instanceof Error ? error.message : "Failed to create payment");
    }
  };
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
    }
  };

  // Fix pledge options with useMemo and deduplication
  const pledgeOptions = useMemo(() => {
    if (!pledgesData?.pledges) return [];

    // Remove duplicates by pledge ID
    const uniquePledges = pledgesData.pledges.reduce((acc, pledge) => {
      if (!acc.find(p => p.id === pledge.id)) {
        acc.push(pledge);
      }
      return acc;
    }, [] as Pledge[]);

    // Filter pledges with scheduledAmount > 0
    const filteredPledges = uniquePledges;

    return filteredPledges.map((pledge: Pledge) => {
      // Calculate unscheduledAmount as balance minus scheduledAmount if available
      const balanceNum = parseFloat(pledge.balance);
      // Parse scheduledAmount from string to number
      const scheduledAmountNum = parseFloat((pledge as any).scheduledAmount || '0');
      const unscheduledAmountNum = Math.max(0, balanceNum - scheduledAmountNum);

      return {
        label: `#${pledge.id} - ${pledge.description || "No description"} (${pledge.currency} ${unscheduledAmountNum.toLocaleString()})`,
        value: pledge.id,
        balance: balanceNum,
        unscheduledAmount: unscheduledAmountNum,
        currency: pledge.currency,
        description: pledge.description || "No description",
        originalAmount: parseFloat(pledge.originalAmount),
      };
    });
  }, [pledgesData?.pledges]);

  const solicitorOptions = useMemo(() => {
    if (!solicitorsData?.solicitors) return [];

    return solicitorsData.solicitors.map((solicitor: Solicitor) => ({
      label: `${solicitor.firstName} ${solicitor.lastName}${solicitor.id ? ` (${solicitor.id})` : ""}`,
      value: solicitor.id,
      commissionRate: solicitor.commissionRate,
      contact: solicitor.contact,
    }));
  }, [solicitorsData?.solicitors]);

  const contactOptions = useMemo((): ContactOption[] => {
    if (!contactsData?.contacts) return [];

    return contactsData.contacts.map((contact: Contact): ContactOption => ({
      label: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(),
      value: contact.id,
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(),
    }));
  }, [contactsData?.contacts]);

  const multiContactOptions = useMemo((): ContactOption[] => {
    if (!allContactsForAllocations) return [];

    return allContactsForAllocations.map((contact: Contact): ContactOption => ({
      label: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(),
      value: contact.id,
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      fullName: contact.fullName || `${contact.firstName} ${contact.lastName}`.trim(),
    }));
  }, [allContactsForAllocations]);

  const addAllocation = () => {
    append({
      pledgeId: 0,
      allocatedAmount: 0,
      installmentScheduleId: null,
      notes: null,
      receiptNumber: null,
      receiptType: null,
      receiptIssued: false,
    });
  };

  const removeAllocation = (index: number) => {
    remove(index);
  };

  const handleThirdPartyToggle = (checked: boolean) => {
    form.setValue("isThirdPartyPayment", checked);

    if (!checked) {
      setSelectedThirdPartyContact(null);
      setContactSearch("");
      form.setValue("thirdPartyContactId", null);

      // If third-party is disabled, also disable multi-contact
      // since multi-contact requires third-party payment
      if (showMultiContactSection) {
        setShowMultiContactSection(false);
        form.setValue("isMultiContactPayment", false);
        setMultiContactAllocations([]);
        form.setValue("isSplitPayment", false);
      }
    }
  };

  const handleContactSelect = (contact: Contact) => {
    setSelectedThirdPartyContact(contact);
    form.setValue("thirdPartyContactId", contact.id);
    setContactSearch("");
    // Reset pledge selection when changing contact
    form.setValue("pledgeId", null);
    form.setValue("allocations", [
      {
        pledgeId: 0,
        allocatedAmount: 0,
        installmentScheduleId: null,
        notes: null,
        receiptNumber: null,
        receiptType: null,
        receiptIssued: false,
      },
    ]);
  };

  const handleMultiContactToggle = (checked: boolean) => {
    setShowMultiContactSection(checked);
    form.setValue("isMultiContactPayment", checked);

    if (!checked) {
      setMultiContactAllocations([]);
      // Reset split payment if multi-contact is disabled
      form.setValue("isSplitPayment", false);
    } else {
      // AUTOMATICALLY enable third-party payment when multi-contact is enabled
      // since multi-contact payments are inherently third-party payments
      form.setValue("isThirdPartyPayment", true);

      // Enable split payment when multi-contact is enabled
      form.setValue("isSplitPayment", true);
      form.setValue("pledgeId", null);
    }
  };

  const getExchangeRateForPledge = (pledgeId: number) => {
    if (!exchangeRatesData?.data?.rates || !watchedCurrency || pledgeId === 0) return 1;

    const pledge = allPledgesData.find(p => p.id === pledgeId);
    if (!pledge || pledge.currency === watchedCurrency) return 1;

    const paymentRate = parseFloat(exchangeRatesData.data.rates[watchedCurrency]) || 1;
    const pledgeRate = parseFloat(exchangeRatesData.data.rates[pledge.currency]) || 1;

    return pledgeRate / paymentRate;
  };

  // FIXED: Get amount in pledge currency (using corrected exchange rate)
  const getAmountInPledgeCurrency = (amount: number, pledgeId: number) => {
    const exchangeRate = getExchangeRateForPledge(pledgeId);
    return Math.round(amount * exchangeRate * 100) / 100;
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" className="border-dashed text-white">
          <PlusCircleIcon />
          New Pledge Payment
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[800px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Payment</DialogTitle>
          <DialogDescription>
            {watchedIsThirdParty && selectedThirdPartyContact ? (
              <div>
                Recording payment for <strong>{selectedThirdPartyContact.fullName}</strong>
                <span className="block mt-1 text-sm text-muted-foreground">
                  This payment will appear in your account but apply to their pledge balance
                </span>
              </div>
            ) : watchedIsMultiContactPayment ? (
              "Record a payment split across multiple contacts and their pledges"
            ) : watchedIsSplitPayment ? (
              "Record a split payment across multiple pledges"
            ) : (
              "Record a payment for a pledge"
            )}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit(form.getValues());
            }}
            className="space-y-6"
          >
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
                      Third-Party Payment (Pay for someone else&apos;s Pledges/Donations)
                    </label>
                  </div>

                  {watchedIsThirdParty && (
                    <div className="space-y-4">
                      {/* Contact Search - Only show when multi-contact is disabled */}
                      {!showMultiContactSection && (
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
                      )}

                      {!showMultiContactSection && contactSearch.length >= 2 && (
                        <div className="border rounded-md max-h-40 overflow-y-auto">
                          {isLoadingContacts ? (
                            <div className="p-3 text-center text-gray-500">Loading contacts...</div>
                          ) : contactOptions.length > 0 ? (
                            contactOptions.map((contact: ContactOption, index: number) => (
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

                      {!showMultiContactSection && selectedThirdPartyContact && (
                        <div className="p-3 bg-blue-50 border border-blue-200 rounded-md">
                          <div className="flex items-center justify-between">
                            <div>
                              <div className="font-medium text-blue-900">
                                Selected Contact: {selectedThirdPartyContact.fullName}
                              </div>
                              <div className="text-sm text-blue-700">
                                Payment will apply to this contact&apos;s Pledges/Donations but appear in your account
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

                      {/* Multi-Contact Toggle */}
                      <div className="border-t pt-4">
                        <div className="flex items-center space-x-2">
                          <Switch
                            className="hidden"
                            id="isMultiContactPayment"
                            checked={showMultiContactSection}
                            onCheckedChange={handleMultiContactToggle}
                          />
                          <label
                            htmlFor="isMultiContactPayment"
                            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 hidden"
                          >
                            Multi-Contact Payment (Split payment across multiple contacts)
                          </label>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Payment Details */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Payment Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {!watchedIsMultiContactPayment && !watchedIsThirdParty && (
                    <div className="flex items-center space-x-2 md:col-span-2">
                      <Switch
                        className="hidden"
                        id="isSplitPayment"
                        checked={watchedIsSplitPayment}
                        onCheckedChange={(checked) => {
                          form.setValue("isSplitPayment", checked);
                          if (checked) {
                            form.setValue("pledgeId", null);
                            form.setValue("allocations", [
                              {
                                pledgeId: 0,
                                allocatedAmount: 0,
                                installmentScheduleId: null,
                                notes: null,
                                receiptNumber: null,
                                receiptType: null,
                                receiptIssued: false,
                              },
                            ]);
                          } else {
                            form.setValue("allocations", [
                              {
                                pledgeId: initialPledgeId || 0,
                                allocatedAmount: 0,
                                installmentScheduleId: null,
                                notes: null,
                                receiptNumber: null,
                                receiptType: null,
                                receiptIssued: false,
                              },
                            ]);
                            if (initialPledgeId && !selectedThirdPartyContact) {
                              form.setValue("pledgeId", initialPledgeId);
                              const initialPledge = pledgesData?.pledges?.find(p => p.id === initialPledgeId);
                              if (initialPledge) {
                                const balance = parseFloat(initialPledge.balance);
                                form.setValue("amount", balance);
                                form.setValue("allocations.0.allocatedAmount", balance);
                                form.setValue(
                                  "currency",
                                  initialPledge.currency as typeof supportedCurrencies[number]
                                );
                              }
                            }
                          }
                        }}
                      />
                      <label
                        htmlFor="isSplitPayment"
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 hidden "
                      >
                        Split Payment Across Multiple Pledges/Donations
                      </label>
                    </div>
                  )}

                  {!watchedIsSplitPayment && !watchedIsMultiContactPayment && (showPledgeSelector || watchedIsThirdParty) && (
                    <FormField
                      control={form.control}
                      name="pledgeId"
                      render={({ field }) => (
                        <FormItem className="flex flex-col md:col-span-2">
                          <FormLabel>
                            Select Pledges/Donations
                            {watchedIsThirdParty && selectedThirdPartyContact && (
                              <span className="text-sm text-muted-foreground ml-2">
                                (from {selectedThirdPartyContact.fullName}&apos;s Pledges/Donations)
                              </span>
                            )}
                          </FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-full justify-between",
                                    (!field.value || field.value === 0) && "text-muted-foreground"
                                  )}
                                  disabled={isLoadingPledges || (watchedIsThirdParty && !selectedThirdPartyContact)}
                                >
                                  {field.value
                                    ? pledgeOptions.find(
                                      (pledge: any) => pledge.value === field.value
                                    )?.label
                                    : isLoadingPledges
                                      ? "Loading Pledges/Donations..."
                                      : watchedIsThirdParty && !selectedThirdPartyContact
                                        ? "Select a contact first"
                                        : "Select Pledges/Donations"}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                              <Command>
                                <CommandInput placeholder="Search pledges..." className="h-9" />
                                <CommandList className="max-h-[200px] overflow-y-auto">
                                  <CommandEmpty>No Pledges/Donations found.</CommandEmpty>
                                  <CommandGroup>
                                    {pledgeOptions.map((pledge: any, index: number) => (
                                      <CommandItem
                                        value={pledge.label}
                                        key={`pledge-${pledge.value}-${index}`}
                                        onSelect={() => {
                                          if (field.value === pledge.value) {
                                            field.onChange(null);
                                            form.setValue("allocations.0.pledgeId", undefined);
                                            form.setValue("allocations.0.allocatedAmount", 0);
                                            form.setValue("amount", 0);
                                          } else {
                                            field.onChange(pledge.value);
                                            form.setValue("allocations.0.pledgeId", pledge.value);
                                            form.setValue("allocations.0.allocatedAmount", parseFloat(pledge.balance));
                                            form.setValue("amount", parseFloat(pledge.balance));
                                            const currency = pledge.currency as typeof supportedCurrencies[number];
                                            if (supportedCurrencies.includes(currency)) {
                                              form.setValue("currency", currency);
                                            }
                                          }
                                        }}
                                      >
                                        {pledge.label}
                                        <Check
                                          className={cn(
                                            "ml-auto h-4 w-4",
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
                        </FormItem>
                      )}
                    />
                  )}

                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Amount</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            {...field}
                            onChange={(e) => {
                              const value = e.target.value;
                              field.onChange(value ? parseFloat(value) : 0);
                            }}
                          />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <div className="hidden">
                    <FormField
                      control={form.control}
                      name="currency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Currency</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select a currency" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {supportedCurrencies.map((currency) => (
                                <SelectItem key={currency} value={currency}>
                                  {currency}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                      )}
                    />
                  </div>
                  {/* Exchange Rate - Non-editable input */}
                  <div className="hidden">
                    <FormField
                      control={form.control}
                      name="exchangeRate"
                      render={({ field }) => (
                        <FormItem className="hidden">
                          <FormLabel>
                            Exchange Rate (1 {watchedCurrency} = {field.value} USD)
                          </FormLabel>
                          <FormControl>
                            <Input type="number" step="0.0001" {...field} disabled />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  {/* Hidden USD field */}
                  <FormField
                    control={form.control}
                    name="amountUsd"
                    render={({ field }) => (
                      <FormItem className="hidden">
                        <FormControl>
                          <Input type="number" step="0.01" {...field} disabled />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {/* Pledge Exchange Rate */}
                  <div className="hidden">
                    <FormField
                      control={form.control}
                      name="exchangeRateToPledgeCurrency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Pledges/Donations Exchange Rate (1 {watchedCurrency} = {field.value} {selectedPledgeCurrency || "USD"})
                          </FormLabel>
                          <FormControl>
                            <Input type="number" step="0.0001" {...field} disabled />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  {/* Amount in Pledge Currency */}
                  <div className="hidden">
                    <FormField
                      control={form.control}
                      name="amountInPledgeCurrency"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount in Pledges/Donations Currency ({selectedPledgeCurrency || "USD"})</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" {...field} disabled />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="paymentDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? ""} onInput={(e) => {
                            const target = e.target as HTMLInputElement;
                            const value = target.value;
                            if (value) {
                              const parts = value.split("-");
                              // Check if year part is longer than 4 digits (handles both YYYY-MM-DD and direct year input)
                              if ((parts.length > 1 && parts[0] && parts[0].length > 4) || (parts.length === 1 && value.length > 4)) {
                                target.value = lastValidPaymentDateRef.current ?? "";
                                return;
                              }
                              lastValidPaymentDateRef.current = value;
                            } else {
                              lastValidPaymentDateRef.current = null;
                            }
                            field.onChange(value);
                          }} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="receivedDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Effective Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? ""} onInput={(e) => {
                            const target = e.target as HTMLInputElement;
                            const value = target.value;
                            if (value) {
                              const parts = value.split("-");
                              if (parts[0] && parts[0].length > 4) {
                                target.value = field.value ?? "";
                                return;
                              }
                            }
                            field.onChange(value);
                          }} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  {/* ADD TAGS FIELD HERE */}
                  <FormField
                    control={form.control}
                    name="tagIds"
                    render={({ field }) => (
                      <FormItem className="flex flex-col md:col-span-2">
                        <FormLabel>Tags</FormLabel>

                        {/* Selected Tags Display */}
                        {selectedTags.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {selectedTags.map((tag: any) => (
                              <Badge
                                key={tag.id}
                                variant="secondary"
                                className="px-2 py-1"
                              >
                                {tag.name}
                                <button
                                  type="button"
                                  onClick={() => handleTagRemove(tag.id)}
                                  className="ml-2 hover:text-red-500 transition-colors"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Tag Selection Popover */}
                        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  "w-full justify-between",
                                  form.formState.errors.tagIds && "border-red-500"
                                )}
                                disabled={isLoadingTags}
                              >
                                {isLoadingTags ? (
                                  "Loading tags..."
                                ) : availableTags.length === 0 ? (
                                  "No tags available"
                                ) : (
                                  <>Add tags ({selectedTags.length} selected)</>
                                )}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-full p-0" align="start">
                            <Command shouldFilter={true}>
                              <CommandInput
                                placeholder="Search tags..."
                                className="h-9 border-0 border-b rounded-none focus:ring-0"
                              />
                              <CommandList className="max-h-[300px] overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
                                {availableTags.length === 0 && !isLoadingTags && (
                                  <CommandEmpty>No tags available.</CommandEmpty>
                                )}

                                {/* Loading state */}
                                {isLoadingTags && (
                                  <div className="flex items-center justify-center py-6 text-sm text-muted-foreground">
                                    Loading tags...
                                  </div>
                                )}

                                {/* Available tags */}
                                {availableTags.length > 0 && !isLoadingTags && (
                                  <CommandEmpty>No tags match your search.</CommandEmpty>
                                )}

                                <CommandGroup className="p-2">
                                  {availableTags.map((tag: any) => {
                                    const isSelected = selectedTagIds.includes(tag.id);

                                    return (
                                      <CommandItem
                                        key={tag.id}
                                        value={tag.name}
                                        keywords={[tag.name, tag.description]}
                                        onSelect={() => handleTagToggle(tag.id)}
                                        className={cn(
                                          "flex items-center space-x-2 rounded-sm px-2 py-2 cursor-pointer transition-colors",
                                          "hover:bg-accent hover:text-accent-foreground",
                                          isSelected && "bg-accent/50"
                                        )}
                                      >
                                        <div className="flex items-center space-x-2 flex-1 min-w-0">
                                          <div className="flex-1 min-w-0">
                                            <div className="font-medium truncate">{tag.name}</div>
                                            {tag.description && (
                                              <div className="text-xs text-muted-foreground truncate">
                                                {tag.description}
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                        <Check
                                          className={cn(
                                            "h-4 w-4 flex-shrink-0",
                                            isSelected ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>

                        <FormDescription>
                          Select tags to categorize this payment for better organization and filtering.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Multi-Contact Payment Section - With Searchable Dropdowns */}
            {showMultiContactSection && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Multi-Contact Payment Allocation
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-green-700">
                    <p className="font-medium mb-1">Multi-Contact Payment Allocation</p>
                    <p>Allocate this payment across multiple contacts and their pledges.</p>
                  </div>

                  <div className="space-y-4">
                    {/* Multi-Contact Allocations */}
                    {multiContactAllocations.map((allocation, index) => (
                      <Card key={index} className="p-4 bg-white border border-green-200">
                        <div className="flex items-start justify-between mb-4">
                          <h4 className="font-medium text-green-800">Allocation #{index + 1}</h4>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeMultiContactAllocation(index)}
                            className="text-red-600 hover:text-red-800 hover:bg-red-50"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                          {/* Contact Selection - Searchable */}
                          <div>
                            <label className="text-sm font-medium mb-2 block">Contact</label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-full justify-between",
                                    !allocation.contactId && "text-muted-foreground"
                                  )}
                                >
                                  {allocation.contactId && allocation.contactId > 0
                                    ? multiContactOptions.find((contact: ContactOption) => contact.id === allocation.contactId)?.label || "Unknown Contact"
                                    : "Select contact..."}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                <Command>
                                  <CommandInput placeholder="Search contacts..." className="h-9" />
                                  <CommandList className="max-h-[200px] overflow-y-auto">
                                    <CommandEmpty>No contact found.</CommandEmpty>
                                    <CommandGroup>
                                      {multiContactOptions.map((contact: ContactOption, contactIndex: number) => (
                                        <CommandItem
                                          value={contact.label}
                                          key={`multi-contact-option-${contact.id}-${contactIndex}`}
                                          onSelect={() => {
                                            updateMultiContactAllocation(index, 'contactId', contact.id);
                                            // Reset pledge when contact changes
                                            updateMultiContactAllocation(index, 'pledgeId', 0);
                                          }}
                                        >
                                          <Check
                                            className={cn(
                                              "mr-2 h-4 w-4",
                                              contact.id === allocation.contactId ? "opacity-100" : "opacity-0"
                                            )}
                                          />
                                          {contact.label}
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>

                          {/* Pledge Selection - Searchable */}
                          <div>
                            <label className="text-sm font-medium mb-2 block">Pledge</label>
                            <Popover>
                              <PopoverTrigger asChild>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-full justify-between",
                                    (!allocation.pledgeId || allocation.pledgeId === 0) && "text-muted-foreground"
                                  )}
                                  disabled={!allocation.contactId || allocation.contactId === 0}
                                >
                                  {allocation.pledgeId && allocation.pledgeId > 0
                                    ? (() => {
                                      const pledge = allPledgesData.find(p => p.id === allocation.pledgeId);
                                      return pledge
                                        ? `#${pledge.id} - ${pledge.description || "No description"} (${pledge.currency} ${parseFloat(pledge.balance).toLocaleString()})`
                                        : "Unknown Pledges/Donations";
                                    })()
                                    : allocation.contactId && allocation.contactId > 0
                                      ? "Select Pledges/Donations..."
                                      : "Select contact first"}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                <Command>
                                  <CommandInput placeholder="Search pledges..." className="h-9" />
                                  <CommandList className="max-h-[200px] overflow-y-auto">
                                    <CommandEmpty>No pledge found.</CommandEmpty>
                                    <CommandGroup>
                                      {allPledgesData
                                        .filter(pledge => pledge.contactId === allocation.contactId)
                                        .map((pledge, pledgeIndex: number) => (
                                          <CommandItem
                                            value={`#${pledge.id} - ${pledge.description || "No description"}`}
                                            key={`pledge-option-${pledge.id}-${pledgeIndex}`}
                                            onSelect={() => {
                                              updateMultiContactAllocation(index, 'pledgeId', pledge.id);
                                            }}
                                          >
                                            <Check
                                              className={cn(
                                                "mr-2 h-4 w-4",
                                                pledge.id === allocation.pledgeId ? "opacity-100" : "opacity-0"
                                              )}
                                            />
                                            #{pledge.id} - {pledge.description || "No description"} ({pledge.currency} {parseFloat(pledge.balance).toLocaleString()})
                                          </CommandItem>
                                        ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                          {/* Allocated Amount */}
                          <div>
                            <label className="text-sm font-medium mb-2 block">
                              Allocated Amount ({watchedCurrency || "USD"})
                            </label>
                            <Input
                              type="number"
                              step="0.01"
                              value={allocation.allocatedAmount || ""}
                              onChange={(e) => updateMultiContactAllocation(index, 'allocatedAmount', parseFloat(e.target.value) || 0)}
                              placeholder="0.00"
                            />
                          </div>

                          {/* Amount in Pledge Currency */}
                          {allocation.pledgeId > 0 && (
                            <div>
                              <label className="text-sm font-medium mb-2 block">
                                Amount in Pledge Currency
                              </label>
                              <Input
                                type="text"
                                disabled
                                value={(() => {
                                  const pledge = allPledgesData.find(p => p.id === allocation.pledgeId);
                                  if (!pledge || !allocation.allocatedAmount) return "0.00";
                                  const convertedAmount = getAmountInPledgeCurrency(allocation.allocatedAmount, allocation.pledgeId);
                                  return `${pledge.currency} ${convertedAmount.toLocaleString()}`;
                                })()}
                                className="bg-gray-50"
                              />
                            </div>
                          )}
                        </div>

                        {/* Receipt Fields */}
                        <div className="grid grid-cols-3 gap-4 mb-4">
                          <div>
                            <label className="text-sm font-medium mb-2 block">Receipt Number</label>
                            <Input
                              value={allocation.receiptNumber || ""}
                              onChange={(e) => updateMultiContactAllocation(index, 'receiptNumber', e.target.value || null)}
                              placeholder="Optional receipt number"
                            />
                          </div>

                          <div>
                            <label className="text-sm font-medium mb-2 block">Receipt Type</label>
                            <Select
                              value={allocation.receiptType || "none"}
                              onValueChange={(value) => updateMultiContactAllocation(index, 'receiptType', value === "none" ? null : value)}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select type..." />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {receiptTypes.map((type) => (
                                  <SelectItem key={type.value} value={type.value}>
                                    {type.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="flex items-end">
                            <div className="flex items-center space-x-2">
                              <Switch
                                id={`receipt-issued-${index}`}
                                checked={allocation.receiptIssued || false}
                                onCheckedChange={(checked) => updateMultiContactAllocation(index, 'receiptIssued', checked)}
                              />
                              <label htmlFor={`receipt-issued-${index}`} className="text-sm">
                                Receipt Issued
                              </label>
                            </div>
                          </div>
                        </div>

                        {/* Notes */}
                        <div>
                          <label className="text-sm font-medium mb-2 block">Notes (Optional)</label>
                          <Textarea
                            value={allocation.notes || ""}
                            onChange={(e) => updateMultiContactAllocation(index, 'notes', e.target.value || null)}
                            placeholder="Add any notes for this allocation..."
                            rows={2}
                          />
                        </div>

                        {/* Pledge Balance Display */}
                        {allocation.pledgeId > 0 && (
                          <div className="mt-4 p-3 bg-gray-50 rounded-md">
                            <div className="text-sm">
                              <div className="flex justify-between">
                                <span>Pledge Balance:</span>
                                <span className="font-medium">
                                  {(() => {
                                    const pledge = allPledgesData.find(p => p.id === allocation.pledgeId);
                                    return pledge ? `${pledge.currency} ${parseFloat(pledge.balance).toLocaleString()}` : "Unknown";
                                  })()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>Amount in Pledge Currency:</span>
                                <span className="font-medium">
                                  {(() => {
                                    const pledge = allPledgesData.find(p => p.id === allocation.pledgeId);
                                    if (!pledge || !allocation.allocatedAmount) return "0.00";
                                    const convertedAmount = getAmountInPledgeCurrency(allocation.allocatedAmount, allocation.pledgeId);
                                    return `${pledge.currency} ${convertedAmount.toLocaleString()}`;
                                  })()}
                                </span>
                              </div>
                              <div className="flex justify-between">
                                <span>After allocation:</span>
                                <span className="font-medium">
                                  {(() => {
                                    const pledge = allPledgesData.find(p => p.id === allocation.pledgeId);
                                    if (!pledge || !allocation.allocatedAmount) return pledge ? `${pledge.currency} ${parseFloat(pledge.balance).toLocaleString()}` : "Unknown";
                                    const convertedAmount = getAmountInPledgeCurrency(allocation.allocatedAmount, allocation.pledgeId);
                                    const afterAllocation = parseFloat(pledge.balance) - convertedAmount;
                                    return `${pledge.currency} ${afterAllocation.toLocaleString()}`;
                                  })()}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </Card>
                    ))}

                    {/* Add New Allocation Button */}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => addMultiContactAllocation()}
                      className="w-full flex items-center gap-2 border-green-300 text-green-700 hover:bg-green-100"
                    >
                      <Plus className="h-4 w-4" />
                      Add Another Allocation
                    </Button>

                    {/* Multi-Contact Summary */}
                    <div className="p-4 bg-white border border-green-200 rounded-lg">
                      <h4 className="font-medium text-green-800 mb-3">Payment Summary</h4>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span>Payment Amount:</span>
                          <span className="font-medium">{watchedCurrency || "USD"} {(watchedAmount || 0).toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Total Allocated:</span>
                          <span className="font-medium">{watchedCurrency || "USD"} {getTotalMultiContactAllocation().toLocaleString()}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Remaining:</span>
                          <span className={cn(
                            "font-medium",
                            Math.abs((watchedAmount || 0) - getTotalMultiContactAllocation()) > 0.01
                              ? "text-red-600"
                              : "text-green-600"
                          )}>
                            {watchedCurrency || "USD"} {((watchedAmount || 0) - getTotalMultiContactAllocation()).toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {Math.abs((watchedAmount || 0) - getTotalMultiContactAllocation()) > 0.01 && (
                        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                          ⚠️ Total allocations must equal payment amount
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Split Payment Allocations Section */}
            {watchedIsSplitPayment && !showMultiContactSection && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Split className="h-5 w-5" />
                    Payment Allocations
                    <Badge variant="secondary" className="ml-2">
                      {fields.length} allocation{fields.length !== 1 ? "s" : ""}
                    </Badge>
                  </CardTitle>
                  <DialogDescription>
                    {watchedIsThirdParty && selectedThirdPartyContact
                      ? `Add allocation amounts for this split payment to ${selectedThirdPartyContact.fullName}'s pledges`
                      : "Add allocation amounts for this split payment"}
                  </DialogDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {fields.length > 0 ? (
                    fields.map((field, index) => (
                      <div
                        key={`${field.id}-${index}`}
                        className="border border-gray-300 rounded-lg p-6 bg-white shadow-sm hover:shadow-md transition-shadow duration-200"
                      >
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="text-lg font-semibold">Allocation #{index + 1}</h4>
                          {fields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAllocation(index)}
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-800"
                              aria-label={`Remove allocation ${index + 1}`}
                            >
                              <X className="h-5 w-5" />
                            </Button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* Pledge Selection */}
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.pledgeId`}
                            render={({ field }) => (
                              <FormItem
                                className="flex flex-col"
                              >
                                <FormLabel>
                                  Select Pledges/Donations
                                  {watchedIsThirdParty && selectedThirdPartyContact && (
                                    <span className="text-sm text-muted-foreground ml-2">
                                      (from {selectedThirdPartyContact.fullName}&apos;s pledges)
                                    </span>
                                  )}
                                </FormLabel>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <FormControl>
                                      <Button
                                        variant="outline"
                                        role="combobox"
                                        className={cn(
                                          "w-full justify-between",
                                          !field.value && "text-muted-foreground"
                                        )}
                                        disabled={isLoadingPledges || (watchedIsThirdParty && !selectedThirdPartyContact)}
                                      >
                                        {field.value
                                          ? pledgeOptions.find(
                                            (pledge: any) => pledge.value === field.value
                                          )?.label
                                          : isLoadingPledges
                                            ? "Loading pledges..."
                                            : watchedIsThirdParty && !selectedThirdPartyContact
                                              ? "Select a contact first"
                                              : "Select Pledges/Donations"}
                                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                      </Button>
                                    </FormControl>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                                    <Command>
                                      <CommandInput placeholder="Search pledges..." className="h-9" />
                                      <CommandList className="max-h-[200px] overflow-y-auto">
                                        <CommandEmpty>No pledge found.</CommandEmpty>
                                        <CommandGroup>
                                          {pledgeOptions.map((pledge: any, pledgeIndex: number) => (
                                            <CommandItem
                                              value={pledge.label}
                                              key={`pledge-${pledge.value}-${pledgeIndex}-${index}`}
                                              onSelect={() => {
                                                field.onChange(pledge.value);
                                                // Auto-fill allocation amount with unscheduled amount
                                                const currentAllocations = form.getValues("allocations") || [];
                                                if (currentAllocations[index]) {
                                                  form.setValue(
                                                    `allocations.${index}.allocatedAmount`,
                                                    pledge.unscheduledAmount || pledge.balance
                                                  );
                                                }
                                              }}
                                            >
                                              {pledge.label}
                                              <Check
                                                className={cn(
                                                  "ml-auto h-4 w-4",
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
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {/* Allocated Amount */}
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.allocatedAmount`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Allocated Amount ({watchedCurrency || "USD"})</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    {...field}
                                    onChange={(e) => {
                                      const value = e.target.value;
                                      field.onChange(value ? parseFloat(value) : 0);
                                    }}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {/* Receipt Number */}
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.receiptNumber`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Receipt Number</FormLabel>
                                <FormControl>
                                  <Input
                                    placeholder="Optional receipt number"
                                    {...field}
                                    value={field.value ?? ""}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {/* Receipt Type */}
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.receiptType`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Receipt Type</FormLabel>
                                <Select
                                  onValueChange={(value) => field.onChange(value === "none" ? null : value)}
                                  value={field.value || "none"}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select receipt type" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
                                    {receiptTypes.map((type) => (
                                      <SelectItem key={type.value} value={type.value}>
                                        {type.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          {/* Receipt Issued */}
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.receiptIssued`}
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3">
                                <div className="space-y-0.5">
                                  <FormLabel className="text-base">Receipt Issued</FormLabel>
                                  <FormDescription>
                                    Mark if receipt has been issued for this allocation
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          {/* Notes */}
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.notes`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Notes</FormLabel>
                                <FormControl>
                                  <Textarea
                                    placeholder="Optional notes for this allocation..."
                                    {...field}
                                    value={field.value ?? ""}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* Display pledge balance information */}
                        {watchedAllocations?.[index]?.pledgeId && (
                          <div className="mt-4 p-3 bg-gray-50 rounded-md border">
                            <div className="text-sm space-y-1">
                              {(() => {
                                const pledgeId = watchedAllocations[index].pledgeId;
                                const pledge = pledgeOptions.find((p: any) => p.value === pledgeId);
                                const allocatedAmount = watchedAllocations[index].allocatedAmount || 0;

                                if (!pledge) return null;

                                return (
                                  <>
                                    <div className="flex justify-between">
                                      <span>Pledge Balance:</span>
                                      <span className="font-medium">
                                        {pledge.currency} {pledge.balance.toLocaleString()}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Amount in Pledge Currency:</span>
                                      <span className="font-medium">
                                        {pledge.currency} {getAmountInPledgeCurrency(allocatedAmount, pledgeId).toLocaleString()}
                                      </span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>After allocation:</span>
                                      <span className="font-medium">
                                        {pledge.currency} {(pledge.balance - getAmountInPledgeCurrency(allocatedAmount, pledgeId)).toLocaleString()}
                                      </span>
                                    </div>
                                  </>
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="text-center text-gray-500">No allocations added yet.</p>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={addAllocation}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add Allocation
                  </Button>

                  {/* Summary for split payments */}
                  <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <h4 className="font-medium text-blue-900 mb-3">Payment Summary</h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Payment Amount:</span>
                        <span className="font-medium">{watchedCurrency || "USD"} {(watchedAmount || 0).toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Total Allocated:</span>
                        <span className="font-medium">{watchedCurrency || "USD"} {totalAllocatedAmount.toLocaleString()}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Remaining:</span>
                        <span className={cn(
                          "font-medium",
                          Math.abs(remainingToAllocate) > 0.01 ? "text-red-600" : "text-green-600"
                        )}>
                          {watchedCurrency || "USD"} {remainingToAllocate.toLocaleString()}
                        </span>
                      </div>
                    </div>
                    {Math.abs(remainingToAllocate) > 0.01 && (
                      <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                        ⚠️ Total allocations should equal payment amount
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Payment Method & Status */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Payment Method & Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Method Detail - DYNAMIC DROPDOWN */}
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
                                  disabled={!watchedPaymentMethod.current || isLoadingDetailOptions}
                                  className={cn(
                                    "w-full justify-between",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {!watchedPaymentMethod.current ? (
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
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                  <FormField
                    control={form.control}
                    name="accountId"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Account</FormLabel>
                        <Select
                          value={field.value ? field.value.toString() : undefined}
                          onValueChange={(value) => field.onChange(value ? parseInt(value) : null)}
                        >
                          <FormControl>
                            <SelectTrigger disabled={isLoadingAccounts}>
                              <SelectValue placeholder={isLoadingAccounts ? "Loading accounts..." : "Select account"} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {accountsData?.map((account) => (
                              <SelectItem key={account.id} value={account.id.toString()}>
                                {account.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="paymentStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select payment status" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {paymentStatuses.map((status) => (
                              <SelectItem key={status.value} value={status.value}>
                                {status.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="checkDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Check Date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} value={field.value ?? ""} onInput={(e) => {
                            const target = e.target as HTMLInputElement;
                            const value = target.value;
                            if (value) {
                              const parts = value.split("-");
                              if (parts[0] && parts[0].length > 4) {
                                target.value = lastValidCheckDateRef.current ?? "";
                                return;
                              }
                              lastValidCheckDateRef.current = value;
                            } else {
                              lastValidCheckDateRef.current = null;
                            }
                            field.onChange(value);
                          }} />
                        </FormControl>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="checkNumber"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Check Number</FormLabel>
                        <FormControl>
                          <Input {...field} value={field.value ?? ""} />
                        </FormControl>
                      </FormItem>
                    )}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Solicitor Section */}
            {/* <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-lg">Solicitor & Commission</CardTitle>
                <Switch
                  checked={showSolicitorSection}
                  onCheckedChange={setShowSolicitorSection}
                />
              </CardHeader>
              {showSolicitorSection && (
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="solicitorId"
                      render={({ field }) => (
                        <FormItem className="flex flex-col">
                          <FormLabel>Solicitor</FormLabel>
                          <Popover>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-full justify-between",
                                    !field.value && "text-muted-foreground"
                                  )}
                                  disabled={isLoadingSolicitors}
                                >
                                  {field.value
                                    ? solicitorOptions.find(
                                      (solicitor: any) => solicitor.value === field.value
                                    )?.label
                                    : "Select solicitor"}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                              <Command>
                                <CommandInput placeholder="Search solicitors..." className="h-9" />
                                <CommandList className="max-h-[200px] overflow-y-auto">
                                  <CommandEmpty>No solicitor found.</CommandEmpty>
                                  <CommandGroup>
                                    {solicitorOptions.map((solicitor: any, solicitorIndex: number) => (
                                      <CommandItem
                                        value={solicitor.label}
                                        key={`solicitor-${solicitor.value}-${solicitorIndex}`}
                                        onSelect={() => {
                                          field.onChange(solicitor.value);
                                          // Auto-fill commission rate if available
                                          if (solicitor.commissionRate) {
                                            form.setValue("bonusPercentage", solicitor.commissionRate);
                                          }
                                        }}
                                      >
                                        {solicitor.label}
                                        <Check
                                          className={cn(
                                            "ml-auto h-4 w-4",
                                            solicitor.value === field.value ? "opacity-100" : "opacity-0"
                                          )}
                                        />
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="bonusPercentage"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bonus Percentage (%)</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) => {
                                const value = e.target.value;
                                field.onChange(value ? parseFloat(value) : null);
                              }}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="bonusAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bonus Amount ({watchedCurrency || "USD"})</FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              step="0.01"
                              {...field}
                              value={field.value ?? ""}
                              disabled
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              )}
            </Card> */}

            {/* Notes */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Additional Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Optional notes about this payment..."
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Form Actions */}
            <div className="flex justify-end space-x-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createPaymentMutation.isPending}>
                {createPaymentMutation.isPending ? "Creating..." : "Create Payment"}
              </Button>
            </div>
          </form>
        </Form>

        {/* Pledge Dialog */}
        <PledgeDialog
          open={pledgeDialogOpen}
          onOpenChange={setPledgeDialogOpen}
          contactId={targetContactId || 0}
        />
      </DialogContent>
    </Dialog>
  );
}
