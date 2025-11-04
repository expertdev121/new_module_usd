/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, ChevronsUpDown, Edit, Users, Split, AlertTriangle, Plus, X, Search, UserPlus, RotateCcw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
import {
  usePaymentMethodOptions,
  usePaymentMethodDetailOptions
} from "@/lib/query/usePaymentMethods";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useExchangeRates } from "@/lib/query/useExchangeRates";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useUpdatePaymentMutation } from "@/lib/query/payments/usePaymentQuery";
import { usePledgeDetailsQuery } from "@/lib/query/payment-plans/usePaymentPlanQuery";
import { usePledgesQuery } from "@/lib/query/usePledgeData";
import useContactId from "@/hooks/use-contact-id";
import { useTagsQuery } from "@/lib/query/tags/useTagsQuery";
import { useAccountsQuery } from "@/lib/query/accounts/useAccountsQuery";

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
  contact?: {
    fullName: string;
  };
  contactId?: number;
}
interface Tag {
  id: number;
  name: string;
}

interface TagsSelectorProps {
  value?: number[];
  onChange: (value: number[]) => void;
  availableTags?: Tag[];
}
interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string | null;
  fullName: string;
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

interface Allocation {
  id?: number;
  pledgeId: number;
  allocatedAmount: string;
  notes: string | null;
  installmentScheduleId?: number | null;
  currency?: string;
  allocatedAmountUsd?: string | null;
  pledgeDescription?: string | null;
  receiptNumber?: string | null;
  receiptType?: string | null;
  receiptIssued?: boolean;
  pledgeOwnerName?: string | null;
  pledgeOwnerId?: number | null;
  contactId?: number;
}

interface ContactOption {
  label: string;
  value: number;
  id: number;
  firstName: string;
  lastName: string;
  displayName: string | null;
  fullName: string;
}

interface Payment {
  id: number;
  pledgeId: number | null;
  contactId?: number;
  amount: string;
  currency: string;
  amountUsd: string | null;
  accountId?: number | null;
  amountInPledgeCurrency: string | null;
  exchangeRate: string | null;
  paymentDate: string;
  receivedDate: string | null;
  paymentMethod: string;
  methodDetail: string | null;
  tagIds?: number[];
  paymentStatus: string;
  checkNumber: string | null;
  checkDate?: string | null;
  account?: string | null;
  receiptNumber: string | null;
  receiptType: string | null;
  receiptIssued: boolean;
  solicitorId: number | null;
  bonusPercentage: string | null;
  bonusAmount: string | null;
  bonusRuleId: number | null;
  notes: string | null;
  paymentPlanId: number | null;
  isSplitPayment?: boolean;
  allocationCount?: number;
  allocations?: Allocation[];
  solicitorName?: string | null;
  pledgeDescription?: string | null;
  installmentScheduleId?: number | null;
  // Third-party payment fields
  isThirdPartyPayment?: boolean;
  thirdPartyContactId?: number | null;
  payerContactId?: number | null;
  // Multi-contact payment fields
  isMultiContactPayment?: boolean;
  multiContactAllocations?: ContactAllocation[];
}

const useSolicitors = (params: { search?: string; status?: "active" | "inactive" | "suspended" } = {}) => {
  return useQuery<{ solicitors: Solicitor[] }>({
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
};

const useContacts = (search?: string) =>
  useQuery<{ contacts: Contact[] }>({
    queryKey: ["contacts", search],
    queryFn: async () => {
      if (!search || search.length < 2) return { contacts: [] };
      const response = await fetch(`/api/contacts/search?q=${encodeURIComponent(search)}`);
      if (!response.ok) throw new Error("Failed to fetch contacts");
      return response.json();
    },
    enabled: !!search && search.length >= 2,
  });

const useContactById = (contactId?: number | null) =>
  useQuery<{ contact: Contact }>({
    queryKey: ["contact", contactId],
    queryFn: async () => {
      if (!contactId) throw new Error("Contact ID is required");
      const response = await fetch(`/api/contacts/${contactId}`);
      if (!response.ok) throw new Error("Failed to fetch contact");
      return response.json();
    },
    enabled: !!contactId,
  });

// New hook to fetch pledge details including contact info
const usePledgeWithContact = (pledgeId?: number | null) =>
  useQuery<{ pledge: Pledge; contact: Contact }>({
    queryKey: ["pledge-with-contact", pledgeId],
    queryFn: async () => {
      if (!pledgeId) throw new Error("pledges/donations ID is required");
      const response = await fetch(`/api/pledges/${pledgeId}`);
      if (!response.ok) throw new Error("Failed to fetch pledges/donations");
      return response.json();
    },
    enabled: !!pledgeId,
  });

const supportedCurrencies = [
  "USD", "ILS", "EUR", "JPY", "GBP", "AUD", "CAD", "ZAR",
] as const;

const paymentStatuses = [
  { value: "expected", label: "Expected" },
  { value: "pending", label: "Pending" },
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "refunded", label: "Refunded" },
  { value: "processing", label: "Processing" },
] as const;

const receiptTypes = [
  { value: "invoice", label: "Invoice" },
  { value: "confirmation", label: "Confirmation" },
  { value: "receipt", label: "Receipt" },
  { value: "other", label: "Other" },
] as const;

const accountOptions = [
  { value: "Bank HaPoalim", label: "Bank HaPoalim" },
  { value: "Bank of Montreal", label: "Bank of Montreal" },
  { value: "Mizrachi Tfachot", label: "Mizrachi Tfachot" },
  { value: "MS - Donations", label: "MS - Donations" },
  { value: "MS - Operations", label: "MS - Operations" },
  { value: "Citibank", label: "Citibank" },
  { value: "Pagi", label: "Pagi" },
] as const;

const NO_SELECTION = "__NONE__"; // Sentinel for 'None' selection for Select components
export function TagsSelector({ value = [], onChange, availableTags = [] }: TagsSelectorProps) {
  const selectedTags = availableTags.filter(tag => value.includes(tag.id));

  const handleTagAdd = (tagId: string) => {
    const id = parseInt(tagId);
    if (!value.includes(id)) {
      onChange([...value, id]);
    }
  };

  const handleTagRemove = (tagId: number) => {
    const newValue = value.filter(id => id !== tagId);
    onChange(newValue);
  };

  return (
    <div className="space-y-2">
      <Select onValueChange={handleTagAdd}>
        <SelectTrigger>
          <SelectValue placeholder="Select tags..." />
        </SelectTrigger>
        <SelectContent>
          {/* Show all tags, don't filter out selected ones */}
          {availableTags.map(tag => (
            <SelectItem key={tag.id} value={tag.id.toString()}>
              {tag.name}
              {/* Remove the checkmark - no ✓ needed */}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedTags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedTags.map(tag => (
            <Badge key={tag.id} variant="secondary" className="flex items-center gap-1">
              {tag.name}
              <X
                className="h-3 w-3 cursor-pointer hover:text-red-500"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleTagRemove(tag.id);
                }}
              />
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}


const editPaymentSchema = z
  .object({
    paymentId: z.number().positive(),
    amount: z.number().positive("Amount must be positive").optional(),
    currency: z.enum([...supportedCurrencies] as [string, ...string[]]).optional(),
    amountUsd: z.number().positive("Amount in USD must be positive").optional(),
    amountInPledgeCurrency: z.number().positive("Amount in pledges/donations currency must be positive").optional(),
    exchangeRate: z.number().positive("Exchange rate must be positive").optional(),
    exchangeRateToPledgeCurrency: z.number().positive("Exchange rate to pledges/donations currency must be positive").optional(),
    paymentDate: z.string().min(1, "Payment date is required").optional(),
    receivedDate: z.string().optional().nullable(),
    methodDetail: z.string().optional().nullable(),
    paymentMethod: z.string().optional().nullable(),
    paymentStatus: z.string().optional(),
    accountId: z.number().optional().nullable(),
    tagIds: z.array(z.number()).optional(),
    checkDate: z.string().optional().nullable(),
    checkNumber: z.string().optional().nullable(),
    receiptNumber: z.string().optional().nullable(),
    receiptType: z.string().optional().nullable(),
    receiptIssued: z.boolean().optional(),
    solicitorId: z.number().positive("Solicitor ID must be positive").optional().nullable(),
    bonusPercentage: z.number().min(0).max(100).optional().nullable(),
    bonusAmount: z.number().min(0).optional().nullable(),
    bonusRuleId: z.number().positive("Bonus rule ID must be positive").optional().nullable(),
    notes: z.string().optional().nullable(),
    pledgeId: z.number().positive("Pledges/Donations ID must be positive").optional().nullable(),
    paymentPlanId: z.number().positive("Payment plan ID must be positive").optional().nullable(),
    isSplitPayment: z.boolean().optional(),

    // Third-party payment fields
    isThirdPartyPayment: z.boolean().optional(),
    thirdPartyContactId: z.number().positive().optional().nullable(),
    payerContactId: z.number().positive().optional().nullable(),

    // Multi-contact payment fields
    isMultiContactPayment: z.boolean().optional(),
    multiContactAllocations: z
      .array(
        z.object({
          contactId: z.number().positive(),
          pledgeId: z.number().positive(),
          allocatedAmount: z.number().positive("Amount must be positive"),
          notes: z.string().nullable(),
          receiptNumber: z.string().nullable().optional(),
          receiptType: z.string().nullable().optional(),
          receiptIssued: z.boolean().optional(),
        })
      )
      .optional(),

    allocations: z
      .array(
        z.object({
          id: z.number().optional(),
          pledgeId: z.number().positive(),
          allocatedAmount: z.number().positive("Amount must be positive"),
          notes: z.string().nullable(),
          currency: z.string().optional(),
          receiptNumber: z.string().optional().nullable(),
          receiptType: z.enum(receiptTypes.map((t) => t.value) as [string, ...string[]]).optional().nullable(),
          receiptIssued: z.boolean().optional(),
        })
      )
      .optional(),
    // New fields for installment management
    autoAdjustAllocations: z.boolean().optional(),
    redistributionMethod: z.enum(["proportional", "equal", "custom"]).optional(),
  })
  .refine(
    (data) => {
      if (data.isSplitPayment && data.allocations && data.amount) {
        const totalAllocated = data.allocations.reduce((sum, alloc) => sum + alloc.allocatedAmount, 0);
        return Math.abs(totalAllocated - data.amount) < 0.01;
      }
      return true;
    },
    {
      message: "Total allocated amount must equal payment amount",
      path: ["allocations"],
    }
  )
  .refine(
    (data) => {
      // Third-party payment validation
      if (data.isThirdPartyPayment && !data.thirdPartyContactId) {
        return false;
      }
      return true;
    },
    {
      message: "Third-party contact must be selected for third-party payments",
      path: ["thirdPartyContactId"],
    }
  );

type EditPaymentFormData = z.infer<typeof editPaymentSchema>;

interface EditPaymentDialogProps {
  payment: Payment & { contactId?: number };
  contactId?: number;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export default function EditPaymentDialog({
  payment,
  contactId: propContactId,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: EditPaymentDialogProps) {
  const { data: solicitorsData } = useSolicitors({ status: "active" });
  const contactId = useContactId() || propContactId || payment.contactId;

  // Third-party payment state
  const [contactSearch, setContactSearch] = useState("");
  const [selectedThirdPartyContact, setSelectedThirdPartyContact] = useState<Contact | null>(null);

  // Multi-contact payment state
  const [multiContactAllocations, setMultiContactAllocations] = useState<MultiContactAllocation[]>([]);

  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>(() => {
    return payment.tagIds || [];
  });
  const [paymentMethodOpen, setPaymentMethodOpen] = useState(false);
  const [methodDetailOpen, setMethodDetailOpen] = useState(false);
  const watchedPaymentMethodRef = useRef<string | null | undefined>(payment.paymentMethod);
  const handleTagToggle = (tagId: number) => {
    const currentTagIds = form.getValues("tagIds") || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter(id => id !== tagId)
      : [...currentTagIds, tagId];

    form.setValue("tagIds", newTagIds);
    setSelectedTagIds(newTagIds); // Keep local state in sync
  };

  const handleTagRemove = (tagId: number) => {
    const currentTagIds = form.getValues("tagIds") || [];
    const newTagIds = currentTagIds.filter(id => id !== tagId);

    form.setValue("tagIds", newTagIds);
    setSelectedTagIds(newTagIds); // Keep local state in sync
  };


  // Check if this payment is already a third-party or multi-contact payment
  const isExistingThirdPartyPayment = payment.isThirdPartyPayment || false;
  const { data: tagsData, isLoading: isLoadingTags } = useTagsQuery({
    showOnPayment: true,
    isActive: true
  });

  const availableTags: Tag[] = tagsData?.tags || [];

  // Enhanced multi-contact payment detection logic
  const isExistingMultiContactPayment = useMemo(() => {
    // First check if it's explicitly marked as multi-contact
    if (payment.isMultiContactPayment) {
      return true;
    }

    // Also check if it's a split payment with multiple unique contacts in allocations
    if (payment.isSplitPayment && payment.allocations && payment.allocations.length > 0) {
      const uniqueContacts = new Set(
        payment.allocations
          .map(a => a.pledgeOwnerName || '')
          .filter(name => name && name.trim() !== '')
      );
      return uniqueContacts.size > 1;
    }

    // Check if multiContactAllocations exists and has data
    if (payment.multiContactAllocations && payment.multiContactAllocations.length > 0) {
      return true;
    }

    return false;
  }, [payment.isMultiContactPayment, payment.isSplitPayment, payment.allocations, payment.multiContactAllocations]);

  const existingThirdPartyContactId = payment.thirdPartyContactId || null;

  const { data: pledgeWithContactData, isLoading: isLoadingPledgeWithContact } = usePledgeWithContact(
    // Trigger for any existing third-party payment with a pledge, not just multi-contact
    (isExistingThirdPartyPayment || isExistingMultiContactPayment) && payment.pledgeId ? payment.pledgeId : null
  );

  // Fetch third-party contact details if not available from pledge data
  const { data: thirdPartyContactData } = useContactById(existingThirdPartyContactId);

  const [internalOpen, setInternalOpen] = useState(false);
  const [showSolicitorSection, setShowSolicitorSection] = useState(!!payment.solicitorId);
  const [showAmountChangeWarning, setShowAmountChangeWarning] = useState(false);
  const [autoAdjustAllocations, setAutoAdjustAllocations] = useState(false);
  const [redistributionMethod, setRedistributionMethod] = useState<"proportional" | "equal" | "custom">("proportional");
  const [canConvertToSplit, setCanConvertToSplit] = useState(false);
  const [originalAmount] = useState(parseFloat(payment.amount));

  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (controlledOnOpenChange || (() => { })) : setInternalOpen;

  const isPaymentPlanPayment = payment.paymentPlanId !== null;
  const isSplitPayment = payment.isSplitPayment || false;

  const { data: pledgeData } = usePledgeDetailsQuery(payment.pledgeId || 0, {
    enabled: !!payment.pledgeId && !isSplitPayment && !payment.pledgeDescription,
  });
  const [showMultiContactSection, setShowMultiContactSection] = useState(isExistingMultiContactPayment);

  const { data: allContactsForAllocations } = useQuery({
    queryKey: ['all-contacts-for-multi-contact'],
    queryFn: async () => {
      const response = await fetch(`/api/contacts?limit=100`); // Changed from 1000 to 100
      if (!response.ok) throw new Error('Failed to fetch contacts');
      const data = await response.json();
      return data.contacts || [];
    },
    enabled: showMultiContactSection,
  });


  const form = useForm<EditPaymentFormData>({
    resolver: zodResolver(editPaymentSchema),
    defaultValues: {
      paymentId: payment.id,
      amount: parseFloat(payment.amount),
      currency: payment.currency,
      amountUsd: payment.amountUsd ? parseFloat(payment.amountUsd) : undefined,
      amountInPledgeCurrency: payment.amountInPledgeCurrency ? parseFloat(payment.amountInPledgeCurrency) : undefined,
      exchangeRate: payment.exchangeRate ? parseFloat(payment.exchangeRate) : 1,
      exchangeRateToPledgeCurrency: 1,
      paymentDate: payment.paymentDate,
      tagIds: payment.tagIds || [],
      receivedDate: payment.receivedDate || null,
      paymentMethod: payment.paymentMethod ?? undefined,
      methodDetail: payment.methodDetail || null,
      paymentStatus: payment.paymentStatus ?? undefined,
      accountId: payment.accountId ?? undefined,
      checkDate: payment.checkDate ?? undefined,
      checkNumber: payment.checkNumber ?? undefined,
      receiptNumber: isSplitPayment ? undefined : (payment.receiptNumber ?? undefined),
      receiptType: isSplitPayment ? undefined : (payment.receiptType ?? undefined),
      receiptIssued: isSplitPayment ? false : payment.receiptIssued,
      solicitorId: payment.solicitorId ?? undefined,
      bonusPercentage: payment.bonusPercentage ? parseFloat(payment.bonusPercentage) : undefined,
      bonusAmount: payment.bonusAmount ? parseFloat(payment.bonusAmount) : undefined,
      bonusRuleId: payment.bonusRuleId ?? undefined,
      notes: payment.notes ?? undefined,
      pledgeId: payment.pledgeId || null,
      paymentPlanId: payment.paymentPlanId || null,
      isSplitPayment: isSplitPayment || isExistingMultiContactPayment,
      // Fixed third-party payment defaults
      isThirdPartyPayment: isExistingThirdPartyPayment || isExistingMultiContactPayment,
      thirdPartyContactId: payment.thirdPartyContactId ?? null,
      payerContactId: payment.payerContactId ?? null,
      // Fixed multi-contact payment defaults
      isMultiContactPayment: isExistingMultiContactPayment,
      multiContactAllocations: [],
      autoAdjustAllocations: false,
      redistributionMethod: "proportional",
      allocations: isSplitPayment
        ? payment.allocations
          ? payment.allocations.map((alloc) => ({
            id: alloc.id,
            pledgeId: alloc.pledgeId,
            allocatedAmount: parseFloat(alloc.allocatedAmount),
            notes: alloc.notes,
            currency: alloc.currency ?? payment.currency,
            receiptNumber: alloc.receiptNumber ?? null,
            receiptType: alloc.receiptType ?? null,
            receiptIssued: alloc.receiptIssued ?? false,
          }))
          : []
        : payment.pledgeId
          ? [
            {
              pledgeId: payment.pledgeId,
              allocatedAmount: parseFloat(payment.amount),
              notes: null,
              currency: payment.currency,
              receiptNumber: payment.receiptNumber ?? null,
              receiptType: payment.receiptType ?? null,
              receiptIssued: payment.receiptIssued ?? false,
            },
          ]
          : [],
    },
  });

  const { fields, append, remove, replace } = useFieldArray({
    control: form.control,
    name: "allocations",
  });

  const { options: paymentMethodOptions, isLoading: isLoadingPaymentMethods } = usePaymentMethodOptions();
  const { data: accountsData, isLoading: isLoadingAccounts } = useAccountsQuery();

  const currentPaymentMethod = form.watch("paymentMethod");

  const { options: methodDetailOptions, isLoading: isLoadingDetailOptions } =
    usePaymentMethodDetailOptions(watchedPaymentMethodRef.current ?? undefined);

  const watchedCurrency = form.watch("currency");
  const watchedAmount = form.watch("amount");
  const watchedPaymentDate = form.watch("paymentDate");
  const watchedTagIds = form.watch('tagIds');
  const watchedReceivedDate = form.watch("receivedDate");
  const watchedSolicitorId = form.watch("solicitorId");
  const watchedBonusPercentage = form.watch("bonusPercentage");
  const watchedPaymentMethod = form.watch("paymentMethod");
  const watchedExchangeRate = form.watch("exchangeRate");
  const watchedIsSplitPayment = form.watch("isSplitPayment");
  const watchedIsMultiContactPayment = form.watch("isMultiContactPayment");
  const watchedAllocations = form.watch("allocations");
  const watchedIsThirdParty = form.watch("isThirdPartyPayment");
  const watchedThirdPartyContactId = form.watch("thirdPartyContactId");
  const watchedPledgeId = form.watch("pledgeId");

  const selectedTags = availableTags.filter(tag =>
    (watchedTagIds || []).includes(tag.id)
  );

  // Get pledges for the current contact or third-party contact
  const targetContactId = selectedThirdPartyContact?.id || contactId;
  const { data: pledgesData, isLoading: isLoadingPledges } = usePledgesQuery(
    {
      contactId: targetContactId as number,
      page: 1,
      limit: 100,
      status: undefined,
    },
    { enabled: !!targetContactId && !showMultiContactSection }
  );

  // Contact data for third-party (only when third-party is enabled and not multi-contact)
  const { data: contactsData, isLoading: isLoadingContacts } = useContacts(
    watchedIsThirdParty && !showMultiContactSection ? contactSearch : undefined
  );

  // Multi-contact pledge fetching - get unique contact IDs from allocations
  const multiContactIds = useMemo(() => {
    return [...new Set(multiContactAllocations.map(a => a.contactId).filter(id => id > 0))];
  }, [multiContactAllocations]);

  const { data: multiContactPledgesData, isLoading: isLoadingMultiContactPledges } = useQuery({
    queryKey: ['multi-contact-pledges', multiContactIds],
    queryFn: async () => {
      if (multiContactIds.length === 0) return { pledges: [] };

      console.log('Fetching pledges for contacts:', multiContactIds);

      const pledgePromises = multiContactIds.map(async (contactId) => {
        try {
          const response = await fetch(`/api/pledges?contactId=${contactId}&page=1&limit=100`);
          if (!response.ok) {
            console.warn(`Failed to fetch pledges for contact ${contactId}`);
            return [];
          }
          const data = await response.json();
          return (data.pledges || []).map((pledge: any) => ({ ...pledge, contactId }));
        } catch (error) {
          console.error(`Error fetching pledges for contact ${contactId}:`, error);
          return [];
        }
      });

      const results = await Promise.all(pledgePromises);
      const allPledges = results.flat();

      console.log('Fetched multi-contact pledges:', allPledges.length);
      return { pledges: allPledges };
    },
    enabled: multiContactIds.length > 0,
    staleTime: 2 * 60 * 1000, // 2 minutes
  });

  const allPledgesData = useMemo(() => {
    return multiContactPledgesData?.pledges || [];
  }, [multiContactPledgesData]);

  // NEW: Fetch contacts for existing multi-contact allocations
  const existingContactIds = useMemo(() => {
    if (!payment.multiContactAllocations) return [];
    return [...new Set(payment.multiContactAllocations.map(alloc => alloc.contactId))];
  }, [payment.multiContactAllocations]);

  const { data: existingContactsData, isLoading: isLoadingExistingContacts } = useQuery({
    queryKey: ['existing-multi-contacts', existingContactIds],
    queryFn: async () => {
      if (existingContactIds.length === 0) return { contacts: [] };

      console.log('Fetching existing contacts:', existingContactIds);

      const contactPromises = existingContactIds.map(async (contactId) => {
        const response = await fetch(`/api/contacts/${contactId}`);
        if (!response.ok) throw new Error(`Failed to fetch contact ${contactId}`);
        const data = await response.json();
        return data.contact;
      });

      const results = await Promise.all(contactPromises);
      console.log('Fetched existing contacts:', results);
      return { contacts: results };
    },
    enabled: existingContactIds.length > 0 && (isExistingMultiContactPayment || showMultiContactSection),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

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

  const {
    data: exchangeRatesData,
    isLoading: isLoadingRates,
    error: ratesError,
  } = useExchangeRates(watchedReceivedDate || undefined);

  const totalAllocatedAmount = (watchedAllocations || []).reduce(
    (sum, alloc) => sum + (alloc.allocatedAmount || 0),
    0
  );
  const remainingToAllocate = (watchedAmount || 0) - totalAllocatedAmount;

  useEffect(() => {
    // Pre-select method detail when editing if it exists and options are loaded
    if (payment.methodDetail && methodDetailOptions.length > 0 && !form.getValues("methodDetail")) {
      const matchingDetail = methodDetailOptions.find(opt => opt.value === payment.methodDetail);
      if (matchingDetail) {
        form.setValue("methodDetail", payment.methodDetail);
      }
    }
  }, [methodDetailOptions, payment.methodDetail, form]);

  useEffect(() => {
    watchedPaymentMethodRef.current = currentPaymentMethod;
    // ONLY clear method detail when payment method changes, not on initial load
    if (currentPaymentMethod && currentPaymentMethod !== payment.paymentMethod) {
      form.setValue("methodDetail", "");
    }
  }, [currentPaymentMethod, form, payment.paymentMethod]);

  useEffect(() => {
    if (isExistingMultiContactPayment && multiContactAllocations.length === 0) {
      console.log("Initializing existing multi-contact payment data with pre-fill");

      const initializeWithPrefilledData = async () => {
        let convertedAllocations: MultiContactAllocation[] = [];

        // Method 1: Use payment.multiContactAllocations if available
        if (payment.multiContactAllocations && payment.multiContactAllocations.length > 0) {
          console.log("Using payment.multiContactAllocations", payment.multiContactAllocations);
          payment.multiContactAllocations.forEach((contactAlloc) => {
            contactAlloc.pledges.forEach((pledge) => {
              convertedAllocations.push({
                contactId: contactAlloc.contactId,
                pledgeId: pledge.pledgeId,
                allocatedAmount: pledge.allocatedAmount,
                notes: null,
                receiptNumber: null,
                receiptType: null,
                receiptIssued: false,
              });
            });
          });
        }
        // Method 2: Convert from regular allocations with contact ID resolution
        else if (payment.allocations && payment.allocations.length > 0) {
          console.log("Converting from payment.allocations with contact resolution", payment.allocations);

          for (const alloc of payment.allocations) {
            let contactId = alloc.pledgeOwnerId || alloc.contactId || 0;

            // If no contact ID, fetch from pledge using your data structure
            if (!contactId && alloc.pledgeId) {
              try {
                // Since you have the pledge data structure, use it directly if available
                // Or fetch from API if needed
                const response = await fetch(`/api/pledges/${alloc.pledgeId}`);
                if (response.ok) {
                  const data = await response.json();
                  // Based on your data structure: pledge: {id: 90, ...}, contact: {id: 7, ...}
                  contactId = data.contact?.id || data.pledge?.contactId || 0;
                }
              } catch (error) {
                console.error("Failed to fetch contact from pledge", error);
              }
            }

            convertedAllocations.push({
              contactId: contactId,
              pledgeId: alloc.pledgeId,
              allocatedAmount: parseFloat(alloc.allocatedAmount.toString()),
              notes: alloc.notes,
              receiptNumber: alloc.receiptNumber,
              receiptType: alloc.receiptType,
              receiptIssued: alloc.receiptIssued || false,
            });
          }
        }
        // Method 3: Single pledge payment - create allocation with your data structure
        else if (payment.pledgeId) {
          try {
            const response = await fetch(`/api/pledges/${payment.pledgeId}`);
            if (response.ok) {
              const data = await response.json();
              // Use your data structure: contact: {id: 7, firstName: "automation", lastName: "testing", ...}
              const allocation: MultiContactAllocation = {
                contactId: data.contact?.id || data.pledge?.contactId || 0,
                pledgeId: payment.pledgeId,
                allocatedAmount: parseFloat(payment.amount),
                notes: payment.notes,
                receiptNumber: payment.receiptNumber,
                receiptType: payment.receiptType,
                receiptIssued: payment.receiptIssued || false,
              };
              convertedAllocations = [allocation];
            }
          } catch (error) {
            console.error("Failed to initialize from single pledge", error);
          }
        }

        if (convertedAllocations.length > 0) {
          console.log("Setting multi-contact allocations with pre-filled data", convertedAllocations);
          setMultiContactAllocations(convertedAllocations);
          setShowMultiContactSection(true);

          // Set form values
          form.setValue("isMultiContactPayment", true);
          form.setValue("isSplitPayment", true);
          form.setValue("isThirdPartyPayment", payment.isThirdPartyPayment || false);

          // Set payer/third-party contact IDs
          if (payment.payerContactId) {
            form.setValue("payerContactId", payment.payerContactId);
          }
          if (payment.thirdPartyContactId) {
            form.setValue("thirdPartyContactId", payment.thirdPartyContactId);
          }
        }
      };

      initializeWithPrefilledData();
    }
  }, [
    isExistingMultiContactPayment,
    multiContactAllocations.length,
    payment.multiContactAllocations,
    payment.allocations,
    payment.pledgeId,
    payment.amount,
    payment.notes,
    payment.receiptNumber,
    payment.receiptType,
    payment.receiptIssued,
    payment.isThirdPartyPayment,
    payment.payerContactId,
    payment.thirdPartyContactId,
    form,
  ]);

  const useContactsByIds = (contactIds: number[]) => {
    return useQuery({
      queryKey: ['contacts-by-ids', contactIds],
      queryFn: async () => {
        if (contactIds.length === 0) return { contacts: [] };

        const contactPromises = contactIds.map(async (contactId) => {
          const response = await fetch(`/api/contacts/${contactId}`);
          if (!response.ok) throw new Error(`Failed to fetch contact ${contactId}`);
          const data = await response.json();
          return data.contact;
        });

        const contacts = await Promise.all(contactPromises);
        return { contacts };
      },
      enabled: contactIds.length > 0,
      staleTime: 5 * 60 * 1000, // 5 minutes
    });
  };
  useEffect(() => {
    if (open) {
      console.log("Dialog opened, initializing states");
      console.log("isExistingThirdPartyPayment:", isExistingThirdPartyPayment);
      console.log("isExistingMultiContactPayment:", isExistingMultiContactPayment);
      console.log("payment.pledgeId:", payment.pledgeId);
      console.log("payment.thirdPartyContactId:", payment.thirdPartyContactId);

      // Set initial toggle states
      if (isExistingMultiContactPayment) {
        setShowMultiContactSection(true);
        form.setValue("isMultiContactPayment", true);
        form.setValue("isSplitPayment", true);
      }

      if (isExistingThirdPartyPayment) {
        form.setValue("isThirdPartyPayment", true);
        // For regular third-party payments (not multi-contact), ensure pledge is set
        if (payment.pledgeId && !isExistingMultiContactPayment) {
          form.setValue("pledgeId", payment.pledgeId);
          console.log("Set pledgeId for third-party payment:", payment.pledgeId);
        }
      }
    }
  }, [
    open,
    isExistingMultiContactPayment,
    isExistingThirdPartyPayment,
    payment.pledgeId,
    payment.thirdPartyContactId,
    form
  ]);

  useEffect(() => {
    if (isExistingThirdPartyPayment && selectedThirdPartyContact && payment.pledgeId) {
      const currentPledgeId = form.watch('pledgeId');
      if (!currentPledgeId || currentPledgeId !== payment.pledgeId) {
        console.log('Setting Pledges/Donations for third-party payment:', payment.pledgeId);
        console.log('Selected third-party contact:', selectedThirdPartyContact.fullName || `${selectedThirdPartyContact.firstName} ${selectedThirdPartyContact.lastName}`);
        form.setValue('pledgeId', payment.pledgeId);
      }
    }
  }, [isExistingThirdPartyPayment, selectedThirdPartyContact, payment.pledgeId, form]);

  // Fixed dialog open effect to ensure proper initialization
  useEffect(() => {
    if (open && !internalOpen) {
      console.log("Dialog opened, initializing states");
      console.log("isExistingMultiContactPayment:", isExistingMultiContactPayment);
      console.log("payment.isMultiContactPayment:", payment.isMultiContactPayment);
      console.log("payment.allocations:", payment.allocations?.length);

      // Set initial toggle states
      if (isExistingMultiContactPayment) {
        setShowMultiContactSection(true);
        form.setValue("isMultiContactPayment", true);
        form.setValue("isSplitPayment", true);
      }

      if (isExistingThirdPartyPayment) {
        form.setValue("isThirdPartyPayment", true);
      }
    }
  }, [open, internalOpen, isExistingMultiContactPayment, isExistingThirdPartyPayment, form]);

  useEffect(() => {
    // Initialize third-party contact for existing third-party payments
    // Check for either explicit thirdPartyContactId OR pledge data (for legacy third-party payments)
    if (isExistingThirdPartyPayment && !selectedThirdPartyContact) {
      const initializeThirdPartyContact = async () => {
        try {
          let contactToSet: Contact | null = null;
          let contactId: number | null = null;

          console.log('Initializing third-party contact...');
          console.log('payment.thirdPartyContactId:', payment.thirdPartyContactId);
          console.log('payment.pledgeId:', payment.pledgeId);
          console.log('pledgeWithContactData:', pledgeWithContactData);

          // Primary: Try from pledge contact data if payment has a pledge
          if (payment.pledgeId && pledgeWithContactData?.contact) {
            console.log('Using contact from pledge data:', pledgeWithContactData.contact);
            contactToSet = pledgeWithContactData.contact;
            contactId = pledgeWithContactData.contact.id;
          }

          // Secondary: Use explicit thirdPartyContactId if available
          if (!contactToSet && payment.thirdPartyContactId) {
            contactId = payment.thirdPartyContactId;
            // Try from existing contacts data first
            if (existingContactsData?.contacts) {
              contactToSet = existingContactsData.contacts.find(c => c.id === payment.thirdPartyContactId) || null;
              if (contactToSet) {
                console.log('Using contact from existing contacts data:', contactToSet);
              }
            }
          }

          // Tertiary: Fetch from API if we have a contact ID but no contact object
          if (!contactToSet && contactId) {
            console.log('Fetching third-party contact from API:', contactId);
            const response = await fetch(`/api/contacts/${contactId}`);
            if (response.ok) {
              const data = await response.json();
              contactToSet = data.contact;
              console.log('Fetched contact from API:', contactToSet);
            }
          }

          // Set the contact if found
          if (contactToSet) {
            setSelectedThirdPartyContact(contactToSet);
            form.setValue('thirdPartyContactId', contactToSet.id);
            console.log('Successfully set third-party contact:', contactToSet.fullName || `${contactToSet.firstName} ${contactToSet.lastName}`);

            // For legacy third-party payments, also set the payerContactId to the current contact
            if (!payment.thirdPartyContactId && !payment.payerContactId) {
              form.setValue('payerContactId', contactId || null);
              console.log('Set payer contact ID for legacy third-party payment');
            }
          } else {
            console.warn('Failed to find third-party contact. ContactId:', contactId);
          }

        } catch (error) {
          console.error('Failed to initialize third-party contact:', error);
        }
      };

      initializeThirdPartyContact();
    }
  }, [
    isExistingThirdPartyPayment,
    payment.thirdPartyContactId,
    payment.payerContactId,
    selectedThirdPartyContact,
    payment.pledgeId,
    pledgeWithContactData?.contact,
    existingContactsData?.contacts,
    form
  ]);

  useEffect(() => {
    if (isExistingThirdPartyPayment && selectedThirdPartyContact && payment.pledgeId && !form.watch('pledgeId')) {
      console.log('Setting pledge for third-party payment:', payment.pledgeId);
      form.setValue('pledgeId', payment.pledgeId);
    }
  }, [isExistingThirdPartyPayment, selectedThirdPartyContact, payment.pledgeId, form]);
  // Effect to clear pledge selection when third-party contact changes
  useEffect(() => {
    if (watchedIsThirdParty && !isExistingThirdPartyPayment && !isExistingMultiContactPayment) {
      // Only reset for new third-party payments, not existing ones
      form.setValue("pledgeId", null);
      if (watchedIsSplitPayment && !showMultiContactSection) {
        form.setValue("allocations", [{
          pledgeId: 0,
          allocatedAmount: 0,
          notes: null,
          currency: payment.currency,
          receiptNumber: null,
          receiptType: null,
          receiptIssued: false,
        }]);
      }
    }
  }, [selectedThirdPartyContact, watchedIsThirdParty, watchedIsSplitPayment, form, payment.currency, isExistingThirdPartyPayment, isExistingMultiContactPayment, showMultiContactSection]);

  // Check if payment can be converted to split
  useEffect(() => {
    setCanConvertToSplit(!isPaymentPlanPayment && !isSplitPayment && !!payment.pledgeId);
  }, [isPaymentPlanPayment, isSplitPayment, payment.pledgeId]);

  // Auto-adjust allocations when amount changes
  const redistributeAllocations = useCallback((newAmount: number, method: "proportional" | "equal" | "custom") => {
    if (!watchedIsSplitPayment || !watchedAllocations || watchedAllocations.length === 0) return;

    const totalOriginal = watchedAllocations.reduce(
      (sum, alloc) => sum + (alloc.allocatedAmount || 0),
      0
    );
    if (totalOriginal === 0) return;

    let newAllocations: any[];
    switch (method) {
      case "proportional":
        // Maintain proportional distribution
        newAllocations = watchedAllocations.map((alloc) => {
          const proportion = (alloc.allocatedAmount || 0) / totalOriginal;
          const newAllocationAmount = newAmount * proportion;
          return {
            ...alloc,
            allocatedAmount: newAllocationAmount,
          };
        });
        break;
      case "equal":
        // Distribute equally among all allocations
        const equalAmount = newAmount / watchedAllocations.length;
        newAllocations = watchedAllocations.map((alloc) => ({
          ...alloc,
          allocatedAmount: equalAmount,
        }));
        break;
      case "custom":
      default:
        // Keep existing allocations, user will adjust manually
        newAllocations = [...watchedAllocations];
        break;
    }

    // Ensure the total equals the new amount (handle rounding errors)
    const newTotal = newAllocations.reduce((sum, alloc) => sum + (alloc.allocatedAmount || 0), 0);
    const difference = newAmount - newTotal;
    if (Math.abs(difference) > 0.001 && newAllocations.length > 0) {
      // Add the difference to the first allocation
      const firstAllocation = newAllocations[0];
      const adjustedAmount = (firstAllocation.allocatedAmount || 0) + difference;
      newAllocations[0] = {
        ...firstAllocation,
        allocatedAmount: adjustedAmount,
      };
    }

    replace(newAllocations);
  }, [watchedIsSplitPayment, watchedAllocations, replace]);

  const useContactFromPledge = (pledgeId?: number | null) => {
    return useQuery({
      queryKey: ['contact-from-pledge', pledgeId],
      queryFn: async () => {
        if (!pledgeId) return null;

        const response = await fetch(`/api/pledges/${pledgeId}`);
        if (!response.ok) throw new Error('Failed to fetch pledges/donations contact');

        const data = await response.json();
        return {
          contactId: data.pledge.contactId,
          contactName: data.pledge.contact?.displayName ||
            `${data.pledge.contact?.firstName} ${data.pledge.contact?.lastName}`,
          contact: data.pledge.contact
        };
      },
      enabled: !!pledgeId,
      staleTime: 5 * 60 * 1000, // 5 minutes
    });
  };

  // Handle auto-adjustment when amount changes
  useEffect(() => {
    if (!watchedIsSplitPayment || !autoAdjustAllocations || !watchedAmount) return;

    const currentAmount = watchedAmount;
    const originalTotal = totalAllocatedAmount;

    // Only auto-adjust if the amounts don't match
    if (Math.abs(currentAmount - originalTotal) > 0.01) {
      redistributeAllocations(currentAmount, redistributionMethod);
    }
  }, [watchedAmount, autoAdjustAllocations, redistributionMethod, redistributeAllocations, watchedIsSplitPayment, totalAllocatedAmount]);

  // Show warning when amount changes
  useEffect(() => {
    if (watchedIsSplitPayment && watchedAmount && Math.abs(watchedAmount - originalAmount) > 0.01) {
      setShowAmountChangeWarning(true);
    } else {
      setShowAmountChangeWarning(false);
    }
  }, [watchedAmount, originalAmount, watchedIsSplitPayment]);

  const areAllocationsValid = useMemo(() => {
    console.log('=== Validating Allocations ===');
    console.log('showMultiContactSection:', showMultiContactSection);
    console.log('multiContactAllocations.length:', multiContactAllocations.length);
    console.log('isExistingMultiContactPayment:', isExistingMultiContactPayment);

    if (showMultiContactSection) {
      const totalMultiContact = getTotalMultiContactAllocation();
      const paymentAmount = watchedAmount || parseFloat(payment.amount);

      // For existing multi-contact payments, if no changes were made to allocations,
      // consider it valid if the original payment was valid
      if (isExistingMultiContactPayment && multiContactAllocations.length === 0) {
        console.log('Existing multi-contact with no changes - returning true');
        return true;
      }

      const isValid = Math.abs(totalMultiContact - paymentAmount) <= 0.01;
      console.log('Multi-contact validation result:', isValid);
      return isValid;
    }

    if (!watchedIsSplitPayment || !watchedAllocations || watchedAllocations.length === 0) {
      console.log('Not split payment or no allocations - returning true');
      return true;
    }

    const paymentAmount = watchedAmount || parseFloat(payment.amount);
    const isValid = Math.abs(totalAllocatedAmount - paymentAmount) <= 0.01;
    console.log('Split payment validation result:', isValid);
    return isValid;
  }, [
    showMultiContactSection,
    watchedAmount,
    payment.amount,
    isExistingMultiContactPayment,
    multiContactAllocations.length,
    watchedIsSplitPayment,
    watchedAllocations,
    totalAllocatedAmount
  ]);


  const areAllocationCurrenciesValid = () => {
    if (!watchedIsSplitPayment) return true;
    const paymentCurrency = watchedCurrency || payment.currency;
    return watchedAllocations?.every(
      (allocation) => (allocation.currency || payment.currency) === paymentCurrency
    ) ?? true;
  };

  // Handle manual redistribution
  const handleRedistribute = () => {
    if (watchedAmount) {
      redistributeAllocations(watchedAmount, redistributionMethod);
      toast.success(`Allocations redistributed using ${redistributionMethod} method`);
    }
  };

  // Handle undo split payment functionality
  const handleUndoSplitPayment = (targetPledgeId: number) => {
    // Find the allocation for the target pledge to get receipt info
    const targetAllocation = watchedAllocations?.find(alloc => alloc.pledgeId === targetPledgeId);

    // Convert to regular payment
    form.setValue("isSplitPayment", false);
    form.setValue("isMultiContactPayment", false);
    form.setValue("pledgeId", targetPledgeId);
    setShowMultiContactSection(false);

    // Restore receipt information from the target allocation if available
    if (targetAllocation) {
      form.setValue("receiptNumber", targetAllocation.receiptNumber);
      form.setValue("receiptType", targetAllocation.receiptType);
      form.setValue("receiptIssued", targetAllocation.receiptIssued ?? false);
    } else {
      // Clear receipt fields if no target allocation found
      form.setValue("receiptNumber", null);
      form.setValue("receiptType", null);
      form.setValue("receiptIssued", false);
    }

    // Clear allocations and multi-contact data
    replace([]);
    setMultiContactAllocations([]);

    toast.success(`Split payment converted to regular payment for Pledge #${targetPledgeId}`);
  };

  // Handle third-party payment toggle
  const handleThirdPartyToggle = (checked: boolean) => {
    form.setValue("isThirdPartyPayment", checked);
    if (!checked) {
      setSelectedThirdPartyContact(null);
      setContactSearch("");
      form.setValue("thirdPartyContactId", null);
      form.setValue("payerContactId", null);
      // Also disable multi-contact when third-party is disabled
      setShowMultiContactSection(false);
      form.setValue("isMultiContactPayment", false);
      setMultiContactAllocations([]);
    } else {
      // Set the current contact as the payer when enabling third-party mode
      form.setValue("payerContactId", contactId || null);
    }
  };

  // Handle contact selection
  const handleContactSelect = (contact: Contact) => {
    setSelectedThirdPartyContact(contact);
    form.setValue("thirdPartyContactId", contact.id);
    setContactSearch("");
    // Reset pledge selection when changing contact
    form.setValue("pledgeId", null);
    if (watchedIsSplitPayment && !showMultiContactSection) {
      form.setValue("allocations", [{
        pledgeId: 0,
        allocatedAmount: 0,
        notes: null,
        currency: payment.currency,
        receiptNumber: null,
        receiptType: null,
        receiptIssued: false,
      }]);
    }
  };

  // Handle multi-contact payment toggle
  const handleMultiContactToggle = (checked: boolean) => {
    setShowMultiContactSection(checked);
    form.setValue("isMultiContactPayment", checked);
    if (!checked) {
      setMultiContactAllocations([]);
      // Reset split payment if multi-contact is disabled
      form.setValue("isSplitPayment", false);
    } else {
      // Enable split payment when multi-contact is enabled
      form.setValue("isSplitPayment", true);
      form.setValue("pledgeId", null);
      // Clear regular allocations when switching to multi-contact
      replace([]);
    }
  };

  // Handle split payment toggle
  const handleSplitPaymentToggle = (checked: boolean) => {
    form.setValue("isSplitPayment", checked);
    if (checked) {
      // Converting to split payment
      if (payment.pledgeId && !showMultiContactSection) {
        // Start with current payment as first allocation
        const currentAllocation = {
          pledgeId: payment.pledgeId,
          allocatedAmount: parseFloat(payment.amount),
          notes: null,
          currency: payment.currency,
          receiptNumber: payment.receiptNumber || null,
          receiptType: payment.receiptType || null,
          receiptIssued: payment.receiptIssued ?? false,
        };
        replace([currentAllocation]);
      } else if (!showMultiContactSection) {
        // No existing pledge, start with empty allocation
        replace([{
          pledgeId: 0,
          allocatedAmount: 0,
          notes: null,
          currency: payment.currency,
          receiptNumber: null,
          receiptType: null,
          receiptIssued: false,
        }]);
      }
      // Clear single payment fields
      if (!showMultiContactSection) {
        form.setValue("pledgeId", null);
      }
      form.setValue("receiptNumber", null);
      form.setValue("receiptType", null);
      form.setValue("receiptIssued", false);
    } else {
      // Converting back to single payment
      if (watchedAllocations && watchedAllocations.length > 0 && !showMultiContactSection) {
        const firstAllocation = watchedAllocations[0];
        form.setValue("pledgeId", firstAllocation.pledgeId);
        form.setValue("receiptNumber", firstAllocation.receiptNumber);
        form.setValue("receiptType", firstAllocation.receiptType);
        form.setValue("receiptIssued", firstAllocation.receiptIssued ?? false);
      }
      replace([]);
      // Also disable multi-contact if split is disabled
      setShowMultiContactSection(false);
      form.setValue("isMultiContactPayment", false);
      setMultiContactAllocations([]);
    }
  };

  // Add new allocation
  const addAllocation = () => {
    append({
      pledgeId: 0,
      allocatedAmount: 0,
      notes: null,
      currency: watchedCurrency || payment.currency,
      receiptNumber: null,
      receiptType: null,
      receiptIssued: false,
    });
  };

  // Remove allocation
  const removeAllocation = (index: number) => {
    remove(index);
  };

  // Enhanced exchange rate and date validation effect
  useEffect(() => {
    // Determine the date to use for exchange rate: receivedDate if available, else today's date
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let dateToUse: string | null = null;
    if (watchedReceivedDate) {
      dateToUse = watchedReceivedDate;
    } else {
      // Use today's date in ISO format if no received date
      dateToUse = today.toISOString().split("T")[0];
    }

    if (!dateToUse) return;

    const selectedDate = new Date(dateToUse);
    selectedDate.setHours(0, 0, 0, 0);

    // Clear any existing payment date errors since future dates are now allowed
    form.clearErrors("paymentDate");

    // Refetch exchange rates when dateToUse or currency changes
    // useExchangeRates hook should handle refetching based on dateToUse

    if (watchedCurrency && exchangeRatesData?.data?.rates) {
      const rate = parseFloat(exchangeRatesData.data.rates[watchedCurrency]) || 1;
      form.setValue("exchangeRate", rate);

      // Show appropriate toast based on which date is being used
      if (watchedReceivedDate) {
        if (selectedDate > today) {
          toast.info(`Using today's exchange rate (received date is in future)`);
        } else {
          toast.success(`Exchange rate updated based on received date`);
        }
      } else {
        toast.info(`Using today's exchange rate (no received date set, using today's date)`);
      }
    }
  }, [watchedCurrency, watchedReceivedDate, exchangeRatesData, form]);

  useEffect(() => {
    if (watchedAmount && watchedExchangeRate) {
      const usdAmount = watchedAmount / watchedExchangeRate;
      form.setValue("amountUsd", Math.round(usdAmount * 100) / 100);
    }
  }, [watchedAmount, watchedExchangeRate, form]);

  const pledgeOptions = useMemo(() => {
    if (!pledgesData?.pledges) return [];

    // Remove duplicates by pledge ID
    const uniquePledges = pledgesData.pledges.reduce((acc, pledge) => {
      if (!acc.find(p => p.id === pledge.id)) {
        acc.push(pledge);
      }
      return acc;
    }, [] as Pledge[]);

    const filteredPledges = uniquePledges;

    return filteredPledges.map((pledge: Pledge) => ({
      label: `#${pledge.id} - ${pledge.description || "No description"} (${pledge.currency} ${parseFloat(pledge.balance).toLocaleString()})`,
      value: pledge.id,
      balance: parseFloat(pledge.balance),
      currency: pledge.currency,
      description: pledge.description || "No description",
      originalAmount: parseFloat(pledge.originalAmount),
    }));
  }, [pledgesData?.pledges]);

  // Calculate amount in pledge currency
  useEffect(() => {
    if (watchedAmount && watchedCurrency && watchedPledgeId != null && exchangeRatesData?.data?.rates && !watchedIsSplitPayment) {
      const pledgeOption = pledgeOptions.find(p => p.value === watchedPledgeId);
      if (pledgeOption) {
        const pledgeCurrency = pledgeOption.currency;

        // Skip calculation if payment currency and pledge currency are the same
        if (watchedCurrency === pledgeCurrency) {
          form.setValue("amountInPledgeCurrency", watchedAmount);
          return;
        }

        const paymentCurrencyRate = parseFloat(exchangeRatesData.data.rates[watchedCurrency]) || 1;
        const pledgeCurrencyRate = parseFloat(exchangeRatesData.data.rates[pledgeCurrency]) || 1;

        if (paymentCurrencyRate && pledgeCurrencyRate) {
          // Convert payment amount to USD first, then to pledge currency
          const amountInUSD = watchedAmount / paymentCurrencyRate;
          const amountInPledgeCurrency = amountInUSD * pledgeCurrencyRate;
          form.setValue("amountInPledgeCurrency", Math.round(amountInPledgeCurrency * 100) / 100);
        }
      }
    } else if (watchedIsSplitPayment || !watchedPledgeId) {
      // For split payments or no pledge selected, clear the field
      // Use undefined instead of null for TypeScript compatibility
      form.setValue("amountInPledgeCurrency", undefined);
    }
  }, [watchedAmount, watchedCurrency, watchedPledgeId, exchangeRatesData, watchedIsSplitPayment, pledgeOptions, form]);

  useEffect(() => {
    if (watchedCurrency && watchedPledgeId != null && exchangeRatesData?.data?.rates && !watchedIsSplitPayment) {
      const pledgeOption = pledgeOptions.find(p => p.value === watchedPledgeId);
      if (pledgeOption) {
        const pledgeCurrency = pledgeOption.currency;

        // Skip calculation if payment currency and pledge currency are the same
        if (watchedCurrency === pledgeCurrency) {
          form.setValue("exchangeRateToPledgeCurrency", 1);
          return;
        }

        const paymentCurrencyRate = parseFloat(exchangeRatesData.data.rates[watchedCurrency]) || 1;
        const pledgeCurrencyRate = parseFloat(exchangeRatesData.data.rates[pledgeCurrency]) || 1;

        if (paymentCurrencyRate && pledgeCurrencyRate) {
          // Calculate the exchange rate from payment currency to pledge currency
          const exchangeRateToPledge = pledgeCurrencyRate / paymentCurrencyRate;
          form.setValue("exchangeRateToPledgeCurrency", Math.round(exchangeRateToPledge * 10000) / 10000);
        }
      }
    } else if (watchedIsSplitPayment || !watchedPledgeId) {
      // For split payments or no pledge selected, reset to 1
      form.setValue("exchangeRateToPledgeCurrency", 1);
    }
  }, [watchedCurrency, watchedPledgeId, exchangeRatesData, watchedIsSplitPayment, pledgeOptions, form]);

  useEffect(() => {
    if (watchedBonusPercentage != null && watchedAmount != null) {
      const bonusAmount = (watchedAmount * watchedBonusPercentage) / 100;
      form.setValue("bonusAmount", Math.round(bonusAmount * 100) / 100);
    } else {
      // Use undefined instead of null for TypeScript compatibility
      form.setValue("bonusAmount", undefined);
    }
  }, [watchedBonusPercentage, watchedAmount, form]);

  useEffect(() => {
    setShowSolicitorSection(!!watchedSolicitorId);
  }, [watchedSolicitorId]);

  // Update allocation currencies when payment currency changes
  useEffect(() => {
    if (
      watchedIsSplitPayment &&
      watchedCurrency &&
      watchedAllocations &&
      watchedAllocations.length > 0
    ) {
      const needsUpdate = watchedAllocations.some(a => a.currency !== watchedCurrency);
      if (needsUpdate) {
        const updatedAllocations = watchedAllocations.map(allocation => ({
          ...allocation,
          currency: watchedCurrency,
        }));
        replace(updatedAllocations);
      }
    }
  }, [watchedCurrency, watchedIsSplitPayment, watchedAllocations, replace]);

  // Reset form and allocations on close
  const resetForm = useCallback(() => {
    form.reset({
      paymentId: payment.id,
      amount: parseFloat(payment.amount),
      currency: payment.currency,
      amountUsd: payment.amountUsd ? parseFloat(payment.amountUsd) : undefined,
      amountInPledgeCurrency: payment.amountInPledgeCurrency
        ? parseFloat(payment.amountInPledgeCurrency)
        : undefined,
      exchangeRate: payment.exchangeRate ? parseFloat(payment.exchangeRate) : 1,
      exchangeRateToPledgeCurrency: 1,
      paymentDate: payment.paymentDate,
      receivedDate: payment.receivedDate || null,
      paymentMethod: payment.paymentMethod,
      methodDetail: payment.methodDetail || null,
      paymentStatus: payment.paymentStatus,
      accountId: payment.accountId ?? null,
      checkDate: payment.checkDate || null,
      checkNumber: payment.checkNumber || null,
      receiptNumber: isSplitPayment ? null : payment.receiptNumber || null,
      receiptType: isSplitPayment ? null : payment.receiptType || null,
      receiptIssued: isSplitPayment ? false : payment.receiptIssued,
      solicitorId: payment.solicitorId || null,
      bonusPercentage: payment.bonusPercentage ? parseFloat(payment.bonusPercentage) : null,
      bonusAmount: payment.bonusAmount ? parseFloat(payment.bonusAmount) : null,
      bonusRuleId: payment.bonusRuleId || null,
      notes: payment.notes || null,
      pledgeId: payment.pledgeId || null,
      paymentPlanId: payment.paymentPlanId || null,
      isSplitPayment: isSplitPayment,
      isThirdPartyPayment: isExistingThirdPartyPayment,
      thirdPartyContactId: existingThirdPartyContactId,
      tagIds: payment.tagIds || [],
      payerContactId: payment.payerContactId || null,
      isMultiContactPayment: isExistingMultiContactPayment,
      multiContactAllocations: [],
      autoAdjustAllocations: false,
      redistributionMethod: "proportional",
    });
    setShowSolicitorSection(!!payment.solicitorId);
    setAutoAdjustAllocations(false);
    setRedistributionMethod("proportional");
    setShowAmountChangeWarning(false);
    setSelectedThirdPartyContact(null);
    setContactSearch("");
    setShowMultiContactSection(isExistingMultiContactPayment);
    setMultiContactAllocations([]);
    setSelectedTagIds(payment.tagIds || []);

    // Reset allocations
    const initialAllocations = isSplitPayment && payment.allocations
      ? payment.allocations.map(alloc => ({
        id: alloc.id,
        pledgeId: alloc.pledgeId,
        allocatedAmount: parseFloat(alloc.allocatedAmount),
        notes: alloc.notes,
        currency: alloc.currency || payment.currency,
        receiptNumber: alloc.receiptNumber || null,
        receiptType: alloc.receiptType || null,
        receiptIssued: alloc.receiptIssued ?? false,
      }))
      : payment.pledgeId
        ? [{
          pledgeId: payment.pledgeId,
          allocatedAmount: parseFloat(payment.amount),
          notes: null,
          currency: payment.currency,
          receiptNumber: payment.receiptNumber || null,
          receiptType: payment.receiptType || null,
          receiptIssued: payment.receiptIssued ?? false,
        }]
        : [];
    replace(initialAllocations);
  }, [form, payment, isSplitPayment, replace, isExistingThirdPartyPayment, existingThirdPartyContactId, isExistingMultiContactPayment]);

  const updatePaymentMutation = useUpdatePaymentMutation(watchedIsSplitPayment ? payment.id : watchedPledgeId || payment.pledgeId || 0);

  // Get pledge currency for exchange rate display
  const selectedPledgeCurrency = useMemo(() => {
    if (!watchedPledgeId || !pledgesData?.pledges) return null;
    const pledge = pledgesData.pledges.find(p => p.id === watchedPledgeId);
    return pledge?.currency || null;
  }, [watchedPledgeId, pledgesData?.pledges]);

  const onSubmit = async (data: EditPaymentFormData) => {
    console.log("📝 onSubmit called");
    console.log("showMultiContactSection:", showMultiContactSection);
    console.log("data:", data);
    console.log("multiContactAllocations:", multiContactAllocations);
    console.log("data.allocations:", data.allocations);

    try {
      if (showMultiContactSection) {
        // Handle multi-contact payment validation
        if (!areAllocationsValid) {
          toast.error("Multi-contact payment allocation amounts must equal the total payment amount");
          return;
        }

        // Transform multiContactAllocations to match backend schema
        const transformedAllocations = multiContactAllocations.reduce((acc, allocation) => {
          // Find existing contact group or create new one
          let contactGroup = acc.find((group) => group.contactId === allocation.contactId);

          if (!contactGroup) {
            // Get contact name from various sources
            let contactName = "Unknown Contact";

            // First try multiContactOptions
            const contactOption = multiContactOptions.find((c) => c.id === allocation.contactId);
            if (contactOption) {
              contactName = contactOption.label || contactOption.fullName;
            } else {
              // Try existingContactsData
              const existingContact = existingContactsData?.contacts?.find((c: Contact) => c.id === allocation.contactId);
              if (existingContact) {
                contactName = existingContact.displayName || `${existingContact.firstName} ${existingContact.lastName}`;
              } else {
                // Try allPledgesData for contact info
                const pledgeWithContact = allPledgesData.find(
                  (p) => p.contactId === allocation.contactId || p.contact?.id === allocation.contactId
                );
                if (pledgeWithContact?.contact) {
                  contactName =
                    pledgeWithContact.contact.fullName ||
                    `${pledgeWithContact.contact.firstName} ${pledgeWithContact.contact.lastName}`.trim();
                }
              }
            }

            contactGroup = {
              contactId: allocation.contactId,
              contactName: contactName,
              pledges: [],
            };
            acc.push(contactGroup);
          }

          // Get pledge details
          const pledge = allPledgesData?.find((p) => p.id === allocation.pledgeId);

          // Add pledge to the contact group
          contactGroup.pledges.push({
            pledgeId: allocation.pledgeId,
            pledgeDescription: pledge?.description || `Pledge ${allocation.pledgeId}`,
            currency: pledge?.currency || payment.currency,
            balance: pledge ? parseFloat(pledge.balance.toString()) : 0,
            allocatedAmount: allocation.allocatedAmount,
          });

          return acc;
        }, [] as Array<{ contactId: number; contactName: string; pledges: Array<{ pledgeId: number; pledgeDescription: string; currency: string; balance: number; allocatedAmount: number }> }>);

        // Convert accountId to account name
        let accountName: string | null = null;
        if (data.accountId) {
          const selectedAccount = accountsData?.find((acc) => acc.id === data.accountId);
          accountName = selectedAccount?.name || null;
        }

        const multiContactPayload = {
          ...data,
          account: accountName, // Send account name instead of accountId
          isMultiContactPayment: true,
          multiContactAllocations: transformedAllocations,
          // Clear regular allocations for multi-contact payments
          allocations: [],
        };

        console.log("Submitting multi-contact payload:", multiContactPayload);
        console.log("Transformed allocations:", transformedAllocations);

        await updatePaymentMutation.mutateAsync(multiContactPayload as any);
      } else if (watchedIsSplitPayment) {
        // Handle split payment validation
        if (!areAllocationCurrenciesValid) {
          toast.error("All allocation currencies must match the payment currency");
          return;
        }

        // Convert accountId to account name
        let accountName: string | null = null;
        if (data.accountId) {
          const selectedAccount = accountsData?.find((acc) => acc.id === data.accountId);
          accountName = selectedAccount?.name || null;
        }

        // For split payments, process allocations
        const processedAllocations = watchedAllocations && watchedAllocations.length > 0
          ? watchedAllocations.map((alloc) => ({
            ...alloc,
            allocatedAmount: alloc.allocatedAmount || 0,
            currency: watchedCurrency || payment.currency,
            receiptNumber: alloc.receiptNumber || null,
            receiptType: alloc.receiptType || null,
            receiptIssued: alloc.receiptIssued || false,
          }))
          : [];

        const updateData = {
          ...data,
          account: accountName, // Send account name instead of accountId
          allocations: processedAllocations,
          isThirdPartyPayment: watchedIsThirdParty,
          thirdPartyContactId: watchedIsThirdParty ? (selectedThirdPartyContact?.id || null) : null,
          payerContactId: watchedIsThirdParty ? contactId : null,
        };

        console.log("Submitting split payment:", updateData);
        await updatePaymentMutation.mutateAsync(updateData as any);
      } else {
        // For non-split payments, ensure a pledge is selected
        if (!data.pledgeId) {
          toast.error("Please select a Pledges/Donations for the payment");
          return;
        }

        const isThirdParty = !!data.isThirdPartyPayment || !!selectedThirdPartyContact;

        // Convert accountId to account name
        let accountName: string | null = null;
        if (data.accountId) {
          const selectedAccount = accountsData?.find((acc) => acc.id === data.accountId);
          accountName = selectedAccount?.name || null;
        }

        // Build base payload with third-party fields
        const basePayload = {
          ...data,
          account: accountName, // Send account name instead of accountId
          isThirdPartyPayment: isThirdParty,
          thirdPartyContactId: isThirdParty ? (selectedThirdPartyContact?.id || null) : null,
          payerContactId: isThirdParty ? contactId : null,
        };

        if (isPaymentPlanPayment) {
          // For payment plan payments, allow amount changes but warn about installment impact
          const allowedUpdates = {
            ...basePayload,
          };

          // Remove undefined or empty fields
          const filteredData = Object.fromEntries(
            Object.entries(allowedUpdates).filter(([key, val]) => {
              // Keep essential fields even if they're falsy
              if (["receiptIssued", "autoAdjustAllocations", "isSplitPayment", "isThirdPartyPayment", "isMultiContactPayment"].includes(key)) {
                return true;
              }
              return val !== undefined && val !== null && val !== "";
            })
          );

          console.log("Submitting payment plan payment:", filteredData);
          await updatePaymentMutation.mutateAsync(filteredData as any);
        } else {
          // Remove undefined or empty fields for regular payments
          const filteredData = Object.fromEntries(
            Object.entries(basePayload).filter(([key, val]) => {
              if (["receiptIssued", "autoAdjustAllocations", "isSplitPayment", "isThirdPartyPayment", "isMultiContactPayment"].includes(key)) {
                return true;
              }
              return val !== undefined && val !== null && val !== "";
            })
          );

          console.log("Submitting regular payment:", filteredData);
          await updatePaymentMutation.mutateAsync(filteredData as any);
        }
      }

      // Success handling
      const paymentType = showMultiContactSection
        ? "Multi-contact payment"
        : watchedIsThirdParty
          ? "Third-party payment"
          : "Payment";
      const target = selectedThirdPartyContact ? ` for ${selectedThirdPartyContact.fullName}` : "";

      console.log("Payment update successful");
      toast.success(`${paymentType}${target} updated successfully!`);
      setOpen(false);
    } catch (error) {
      console.error("Payment update error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update payment");
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (isControlled) {
      controlledOnOpenChange?.(newOpen);
    } else {
      setInternalOpen(newOpen);
    }
    if (!newOpen) {
      resetForm();
    }
  };

  const solicitorOptions =
    solicitorsData?.solicitors?.map((solicitor: Solicitor) => ({
      label: `${solicitor.firstName} ${solicitor.lastName}${solicitor.id ? ` (${solicitor.id})` : ""}`,
      value: solicitor.id,
      commissionRate: solicitor.commissionRate,
      contact: solicitor.contact,
    })) || [];

  const contactOptions = useMemo(() => {
    if (!contactsData?.contacts) return [];
    return contactsData.contacts.map((contact: Contact) => ({
      label: contact.displayName || `${contact.firstName} ${contact.lastName}`,
      value: contact.id,
      ...contact,
    }));
  }, [contactsData?.contacts]);

  const multiContactOptions = useMemo((): ContactOption[] => {
    const existingContacts = existingContactsData?.contacts || [];
    const allContacts = allContactsForAllocations || [];

    // Create a combined list with priority to existing contacts
    const contactsMap = new Map<number, Contact>();

    // Add existing contacts first (higher priority)
    existingContacts.forEach((contact: Contact) => {
      contactsMap.set(contact.id, contact);
    });

    // Add all contacts (won't overwrite existing due to Map behavior)
    allContacts.forEach((contact: Contact) => {
      if (!contactsMap.has(contact.id)) {
        contactsMap.set(contact.id, contact);
      }
    });

    const uniqueContacts = Array.from(contactsMap.values());

    return uniqueContacts.map((contact: Contact): ContactOption => ({
      label: contact.displayName || `${contact.firstName} ${contact.lastName}`,
      value: contact.id,
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      displayName: contact.displayName,
      fullName: contact.displayName || `${contact.firstName} ${contact.lastName}`,
    }));
  }, [existingContactsData?.contacts, allContactsForAllocations]);

  const effectivePledgeDescription = pledgeData?.pledge?.description || payment.pledgeDescription || "N/A";

  const formatCurrency = (amount: string | number, currency = "USD") => {
    const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
    return `${currency} ${numAmount.toLocaleString()}`;
  };

  // Get unique contacts from multi-contact allocations
  const getUniqueContacts = () => {
    const contactIds = [...new Set(multiContactAllocations.map(a => a.contactId).filter(id => id > 0))];
    return contactIds.map(id => {
      // First try to find from existing contacts data
      const existingContact = existingContactsData?.contacts?.find((c: Contact) => c.id === id);
      if (existingContact) {
        return { id, fullName: existingContact.displayName || `${existingContact.firstName} ${existingContact.lastName}` };
      }

      // Then try from pledges data
      const contact = allPledgesData.find(p => p.contactId === id || p.contact?.id === id);
      return contact ? { id, fullName: contact.contact?.fullName || "Unknown Contact" } : { id, fullName: "Unknown Contact" };
    });
  };

  // Get exchange rate for specific pledge
  const getExchangeRateForPledge = (pledgeId: number) => {
    if (!exchangeRatesData?.data?.rates || !watchedCurrency || pledgeId === 0) return 1;

    const pledge = allPledgesData.find(p => p.id === pledgeId);
    if (!pledge || pledge.currency === watchedCurrency) return 1;

    const paymentRate = parseFloat(exchangeRatesData.data.rates[watchedCurrency]) || 1;
    const pledgeRate = parseFloat(exchangeRatesData.data.rates[pledge.currency]) || 1;

    return pledgeRate / paymentRate;
  };

  // Get amount in pledge currency
  const getAmountInPledgeCurrency = (amount: number, pledgeId: number) => {
    const exchangeRate = getExchangeRateForPledge(pledgeId);
    return Math.round(amount * exchangeRate * 100) / 100;
  };

  // Fix the redistribution method setter
  const handleRedistributionMethodChange = (value: string) => {
    const method = value as "proportional" | "equal" | "custom";
    setRedistributionMethod(method);
  };

  // Undo Split Section Component
  const UndoSplitSection = () => {
    if (!watchedIsSplitPayment || (!watchedAllocations?.length && !multiContactAllocations.length)) return null;

    const handleUndoWithoutSelectingPledge = () => {
      form.setValue("isSplitPayment", false);
      form.setValue("isMultiContactPayment", false);
      form.setValue("pledgeId", null);
      replace([]);
      setShowMultiContactSection(false);
      setMultiContactAllocations([]);
      toast.success("Split payment undone. You can now select a new pledge.");
    };

    return (
      <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <h4 className="font-medium text-amber-800">Undo Split Payment</h4>
        </div>
        <p className="text-sm text-amber-700 mb-3">
          You can convert this split payment back to a regular payment. Choose one of the options below:
        </p>
        <div className="space-y-3">
          {watchedAllocations && watchedAllocations.length > 0 && (
            <div>
              <p className="text-sm font-medium text-amber-800 mb-2">Option 1: Select a Pledges/Donations to apply the full amount</p>
              <div className="space-y-2">
                {watchedAllocations.map((allocation, index) => {
                  const pledgeOption = pledgeOptions.find(p => p.value === allocation.pledgeId);
                  return (
                    <div key={allocation.pledgeId || index} className="flex items-center justify-between p-2 bg-white rounded border">
                      <div className="flex-1">
                        <div className="font-medium text-sm">
                          {pledgeOption?.label || `Pledge #${allocation.pledgeId}`}
                        </div>
                        <div className="text-xs text-gray-600">
                          Allocated: {formatCurrency(allocation.allocatedAmount || 0, allocation.currency || payment.currency)}
                        </div>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleUndoSplitPayment(allocation.pledgeId)}
                        className="ml-2 text-amber-700 border-amber-300 hover:bg-amber-100"
                      >
                        Select
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {(watchedAllocations?.length || 0) > 0 && multiContactAllocations.length > 0 && (
            <div className="border-t border-amber-200 my-4" />
          )}

          <div>
            <p className="text-sm font-medium text-amber-800 mb-2">Option 2: Undo split and choose Pledges/Donations later</p>
            <p className="text-xs text-amber-700 mb-3">
              This will remove all allocations and allow you to select a new Pledges/Donations for the entire payment amount.
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleUndoWithoutSelectingPledge}
              className="w-full flex items-center gap-2 text-amber-700 border-amber-300 hover:bg-amber-100"
            >
              <RotateCcw className="h-4 w-4" />
              Undo Split and Re-assign
            </Button>
          </div>
        </div>
        <p className="text-xs text-amber-600 mt-4">
          This action will delete all current allocations and convert this back to a regular payment.
        </p>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="h-5 w-5" />
            Edit Payment
            {watchedIsSplitPayment && (
              <Badge variant="outline" className="bg-purple-50 text-purple-700 border-purple-200">
                <Split className="h-3 w-3 mr-1" />
                Split Payment
              </Badge>
            )}
            {watchedIsThirdParty && (
              <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">
                <UserPlus className="h-3 w-3 mr-1" />
                Third-Party
              </Badge>
            )}
            {showMultiContactSection && (
              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                <Users className="h-3 w-3 mr-1" />
                Multi-Contact
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            <div>
              {watchedIsThirdParty && selectedThirdPartyContact ? (
                <div>
                  Editing payment for <strong>{selectedThirdPartyContact.displayName || `${selectedThirdPartyContact.firstName} ${selectedThirdPartyContact.lastName}`}</strong>
                  {payment.pledgeId && (
                    <span className="block mt-1 text-sm text-blue-600">
                      Pledge: #{payment.pledgeId} - {payment.pledgeDescription || "No description"}
                    </span>
                  )}
                  <span className="block mt-1 text-sm text-muted-foreground">
                    This payment will appear in your account but apply to their Pledges/Donations balance
                  </span>
                </div>
              ) : showMultiContactSection ? (
                <div>
                  Edit multi-contact payment affecting {getUniqueContacts().length} contacts
                  <span className="block mt-1 text-sm text-muted-foreground">
                    Total Amount: {payment.currency} {parseFloat(payment.amount).toLocaleString()}
                  </span>
                </div>
              ) : watchedIsSplitPayment ? (
                <>
                  Edit split payment affecting {watchedAllocations?.length || 0} pledges
                  <span className="block mt-1 text-sm text-muted-foreground">
                    Total Amount: {payment.currency} {parseFloat(payment.amount).toLocaleString()}
                  </span>
                  {watchedAllocations && watchedAllocations.length > 0 && (
                    <div className="mt-2 p-2 bg-purple-50 rounded-md">
                      <span className="text-xs font-medium text-purple-700">Current Allocations:</span>
                      <div className="mt-1 space-y-1">
                        {watchedAllocations.slice(0, 3).map((alloc, index) => (
                          <div key={alloc.pledgeId || index} className="flex justify-between text-xs text-purple-600">
                            <span>
                              Pledges/Donations #{alloc.pledgeId}
                            </span>
                            <span>{formatCurrency(alloc.allocatedAmount || 0, alloc.currency || payment.currency)}</span>
                          </div>
                        ))}
                        {watchedAllocations.length > 3 && (
                          <div className="text-xs text-purple-600">
                            ... and {watchedAllocations.length - 3} more
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  Edit payment for pledge{" "}
                  {payment.pledgeDescription ? `"${payment.pledgeDescription}"` : `#${payment.pledgeId}`}
                  <span className="block mt-1 text-sm text-muted-foreground">
                    Current Amount: {payment.currency} {parseFloat(payment.amount).toLocaleString()}
                  </span>
                </>
              )}
              {payment.solicitorName && (
                <span className="block mt-1 text-sm text-muted-foreground">
                  Solicitor: {payment.solicitorName}
                </span>
              )}
              {isPaymentPlanPayment && (
                <span className="block mt-1 text-sm text-blue-600 font-medium">
                  ℹ️ This payment belongs to a payment plan. Changes may affect installment scheduling.
                </span>
              )}
            </div>
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
            <UndoSplitSection />

            {/* Amount Change Warning for Split Payments */}
            {showAmountChangeWarning && watchedIsSplitPayment && (
              <Alert className="border-yellow-200 bg-yellow-50">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <AlertDescription className="text-yellow-800">
                  <div className="space-y-2">
                    <p className="font-medium">Payment amount has changed</p>
                    <p className="text-sm">
                      The current allocations total {formatCurrency(showMultiContactSection ? getTotalMultiContactAllocation() : totalAllocatedAmount, watchedCurrency || payment.currency)}
                      but the payment amount is {formatCurrency(watchedAmount || 0, watchedCurrency || payment.currency)}.
                    </p>
                    <div className="flex items-center gap-2 mt-3">
                      <Switch
                        checked={autoAdjustAllocations}
                        onCheckedChange={setAutoAdjustAllocations}
                        id="auto-adjust"
                      />
                      <label htmlFor="auto-adjust" className="text-sm font-medium">
                        Auto-adjust allocations
                      </label>
                    </div>
                    {autoAdjustAllocations && (
                      <div className="flex items-center gap-4 mt-2">
                        <Select value={redistributionMethod} onValueChange={handleRedistributionMethodChange}>
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="proportional">Proportional</SelectItem>
                            <SelectItem value="equal">Equal distribution</SelectItem>
                            <SelectItem value="custom">Custom (manual)</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={handleRedistribute}
                          className="text-yellow-700 border-yellow-300 hover:bg-yellow-100"
                        >
                          Redistribute Now
                        </Button>
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Basic Payment Information - Moved to top */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Payment Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="amount"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Amount</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
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
                                <SelectValue placeholder="Select currency" />
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
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Exchange Rate and USD Amount */}
                {watchedCurrency !== "USD" && (
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="exchangeRate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Exchange Rate ({watchedCurrency}/USD)
                            {isLoadingRates && <span className="text-xs text-gray-500 ml-1">(Loading...)</span>}
                            {ratesError && <span className="text-xs text-red-500 ml-1">(Rate unavailable)</span>}
                          </FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              step="0.0001"
                              onChange={(e) => field.onChange(parseFloat(e.target.value))}
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="amountUsd"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount in USD</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              step="0.01"
                              disabled
                              value={field.value || ""}
                              className="bg-gray-50"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {/* Date Fields */}
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="paymentDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Date</FormLabel>
                        <FormControl>
                          <Input {...field} type="date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="receivedDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Received Date (Optional)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="date"
                            value={field.value || ""}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

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


              </CardContent>
            </Card>

            {/* Third-Party Payment Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Third-Party Payment Options
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Switch
                    id="third-party-payment"
                    checked={watchedIsThirdParty}
                    onCheckedChange={handleThirdPartyToggle}
                  />
                  <label htmlFor="third-party-payment" className="text-sm font-medium">
                    This payment is made on behalf of another contact
                  </label>
                </div>

                {watchedIsThirdParty && !showMultiContactSection && (
                  <div className="space-y-4 p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <div className="text-sm text-blue-700">
                      <p className="font-medium mb-1">Third-Party Payment Configuration</p>
                      <p>
                        You&apos;re making this payment, but it will be allocated to another contact&apos;s pledges.
                      </p>
                      {selectedThirdPartyContact && (
                        <div className="mt-2 p-2 bg-blue-100 rounded border border-blue-300">
                          <p className="font-medium">Selected Contact:</p>
                          <p>{selectedThirdPartyContact.displayName || `${selectedThirdPartyContact.firstName} ${selectedThirdPartyContact.lastName}`}</p>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {/* Contact Search - with current selection display */}
                      <div className="relative">
                        <label className="text-sm font-medium mb-2 block">
                          Select Contact (who benefits from this payment)
                          {isExistingThirdPartyPayment && selectedThirdPartyContact && (
                            <span className="text-xs text-blue-600 ml-1">(Currently selected from existing payment)</span>
                          )}
                        </label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              className={cn(
                                "w-full justify-between",
                                !selectedThirdPartyContact && "text-muted-foreground"
                              )}
                            >
                              {selectedThirdPartyContact
                                ? (selectedThirdPartyContact.displayName ||
                                  `${selectedThirdPartyContact.firstName} ${selectedThirdPartyContact.lastName}`)
                                : "Search and select contact..."
                              }
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-full p-0">
                            <Command>
                              <CommandInput
                                placeholder="Search contacts..."
                                value={contactSearch}
                                onValueChange={setContactSearch}
                              />
                              <CommandList>
                                <CommandEmpty>
                                  {contactSearch.length < 2
                                    ? "Type at least 2 characters to search..."
                                    : isLoadingContacts
                                      ? "Loading..."
                                      : "No contacts found."
                                  }
                                </CommandEmpty>
                                {contactOptions && contactOptions.length > 0 && (
                                  <CommandGroup>
                                    {contactOptions.map((contact) => (
                                      <CommandItem
                                        key={`contact-${contact.value}`}
                                        value={contact.label}
                                        onSelect={() => handleContactSelect(contact)}
                                        className="flex items-center justify-between"
                                      >
                                        <div className="flex items-center">
                                          <Check
                                            className={cn(
                                              "mr-2 h-4 w-4",
                                              selectedThirdPartyContact?.id === contact.value
                                                ? "opacity-100"
                                                : "opacity-0"
                                            )}
                                          />
                                          <div>
                                            <div className="font-medium">{contact.label}</div>
                                            <div className="text-sm text-gray-500">ID: {contact.id}</div>
                                          </div>
                                        </div>
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                )}
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>

                      {/* Multi-Contact Toggle */}
                      <div className="flex items-center space-x-2 pt-2 border-t border-blue-200">
                        <Switch
                          className="hidden"
                          id="multi-contact-payment"
                          checked={showMultiContactSection}
                          onCheckedChange={handleMultiContactToggle}
                        />
                        <label htmlFor="multi-contact-payment" className="text-sm font-medium hidden">
                          Split this payment across multiple contacts
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                {/* Multi-Contact Payment Section */}
                {showMultiContactSection && (
                  <div className="space-y-4 p-4 bg-green-50 rounded-lg border border-green-200">
                    <div className="text-sm text-green-700">
                      <p className="font-medium mb-1">Multi-Contact Payment Allocation</p>
                      <p>Allocate this payment across multiple contacts and their Pledges/Donations.</p>
                      {isLoadingExistingContacts && (
                        <p className="text-xs text-blue-600 mt-1">Loading existing contact data...</p>
                      )}
                      {isLoadingMultiContactPledges && (
                        <p className="text-xs text-blue-600 mt-1">Loading Pledges/Donations data...</p>
                      )}
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
                            {/* Contact Selection with Loading State */}
                            <div>
                              <label className="text-sm font-medium mb-2 block">Contact</label>
                              <Select
                                value={allocation.contactId?.toString() || "0"}
                                onValueChange={(value) => {
                                  const contactId = parseInt(value);
                                  updateMultiContactAllocation(index, "contactId", contactId);
                                  // Reset pledge when contact changes
                                  updateMultiContactAllocation(index, "pledgeId", 0);
                                }}
                                disabled={isLoadingExistingContacts}
                              >
                                <SelectTrigger>
                                  <SelectValue
                                    placeholder={
                                      isLoadingExistingContacts
                                        ? "Loading contacts..."
                                        : allocation.contactId && allocation.contactId > 0
                                          ? multiContactOptions.find(c => c.id === allocation.contactId)?.label || `Contact ${allocation.contactId}`
                                          : "Select contact..."
                                    }
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">Select contact...</SelectItem>
                                  {multiContactOptions.map((contact) => (
                                    <SelectItem key={contact.id} value={contact.id.toString()}>
                                      {contact.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {/* Pledge Selection with Loading State */}
                            <div>
                              <label className="text-sm font-medium mb-2 block">Pledge</label>
                              <Select
                                value={allocation.pledgeId?.toString() || "0"}
                                onValueChange={(value) => {
                                  const pledgeId = parseInt(value);
                                  updateMultiContactAllocation(index, "pledgeId", pledgeId);
                                }}
                                disabled={!allocation.contactId || allocation.contactId === 0 || isLoadingMultiContactPledges}
                              >
                                <SelectTrigger>
                                  <SelectValue
                                    placeholder={
                                      isLoadingMultiContactPledges
                                        ? "Loading pledges..."
                                        : !allocation.contactId || allocation.contactId === 0
                                          ? "Select contact first"
                                          : allocation.pledgeId && allocation.pledgeId > 0
                                            ? allPledgesData?.find(p => p.id === allocation.pledgeId)?.description || `Pledge ${allocation.pledgeId}`
                                            : "Select pledge..."
                                    }
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">Select pledge...</SelectItem>
                                  {allPledgesData
                                    ?.filter(pledge => pledge.contactId === allocation.contactId)
                                    .map(pledge => (
                                      <SelectItem key={pledge.id} value={pledge.id.toString()}>
                                        {pledge.id} - {pledge.description || "No description"} ({pledge.currency} {parseFloat(pledge.balance).toLocaleString()})
                                      </SelectItem>
                                    ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-4 mb-4">
                            {/* Allocated Amount */}
                            <div>
                              <label className="text-sm font-medium mb-2 block">
                                Allocated Amount ({watchedCurrency || payment.currency})
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
                                  Amount in Pledges/Donations Currency
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
                                value={allocation.receiptType || NO_SELECTION}
                                onValueChange={(value) => updateMultiContactAllocation(index, 'receiptType', value === NO_SELECTION ? null : value)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select type..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value={NO_SELECTION}>None</SelectItem>
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
                        </Card>
                      ))}

                      {/* Add Multi-Contact Allocation Button */}
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => addMultiContactAllocation()}
                        className="w-full flex items-center gap-2 border-green-300 text-green-700 hover:bg-green-50"
                      >
                        <Plus className="h-4 w-4" />
                        Add Another Contact Allocation
                      </Button>

                      {/* Multi-Contact Summary */}
                      <div className="mt-4 p-3 bg-white border border-green-200 rounded-lg">
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">Total Allocations:</span>
                            <div className="font-medium text-green-700">{multiContactAllocations.length}</div>
                          </div>
                          <div>
                            <span className="text-gray-600">Total Amount:</span>
                            <div className="font-medium">
                              {formatCurrency(getTotalMultiContactAllocation(), watchedCurrency || payment.currency)}
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-600">Remaining:</span>
                            <div className={cn(
                              "font-medium",
                              Math.abs((watchedAmount || 0) - getTotalMultiContactAllocation()) > 0.01
                                ? "text-red-600"
                                : "text-green-600"
                            )}>
                              {formatCurrency((watchedAmount || 0) - getTotalMultiContactAllocation(), watchedCurrency || payment.currency)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Split Payment Section */}
            {watchedIsSplitPayment && !showMultiContactSection && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Split className="h-4 w-4" />
                    Payment Allocations
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="text-sm text-gray-600 mb-4">
                    Allocate this payment across multiple pledges. Total allocations must equal payment amount.
                  </div>

                  <div className="flex items-center justify-between mb-4">
                    <div className="text-sm">
                      <span className="font-medium">Payment Amount:</span> {formatCurrency(watchedAmount || 0, watchedCurrency || payment.currency)}
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">Total Allocated:</span>{" "}
                      <span className={cn(
                        Math.abs(totalAllocatedAmount - (watchedAmount || 0)) > 0.01
                          ? "text-red-600"
                          : "text-green-600"
                      )}>
                        {formatCurrency(totalAllocatedAmount, watchedCurrency || payment.currency)}
                      </span>
                    </div>
                    <div className="text-sm">
                      <span className="font-medium">Remaining:</span>{" "}
                      <span className={cn(
                        Math.abs(remainingToAllocate) > 0.01
                          ? "text-red-600"
                          : "text-green-600"
                      )}>
                        {formatCurrency(remainingToAllocate, watchedCurrency || payment.currency)}
                      </span>
                    </div>
                  </div>

                  {/* Allocation Fields */}
                  <div className="space-y-4">
                    {fields.map((field, index) => (
                      <Card key={field.id} className="p-4 bg-gray-50">
                        <div className="flex items-center justify-between mb-4">
                          <h4 className="font-medium">Allocation #{index + 1}</h4>
                          {fields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAllocation(index)}
                              className="text-red-600 hover:text-red-800"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-4 mb-4">
                          {/* Pledge Selection */}
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.pledgeId`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Pledges/Donations</FormLabel>
                                <Select
                                  onValueChange={(value) => field.onChange(parseInt(value))}
                                  value={field.value?.toString() || ""}
                                  disabled={isLoadingPledges}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select Pledges/Donations..." />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    {pledgeOptions.map((option) => (
                                      <SelectItem key={option.value} value={option.value.toString()}>
                                        {option.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
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
                                <FormLabel>Allocated Amount ({watchedCurrency || payment.currency})</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    type="number"
                                    step="0.01"
                                    onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                    value={field.value || ""}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* Receipt Fields */}
                        <div className="grid grid-cols-3 gap-4 mb-4">
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.receiptNumber`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Receipt Number</FormLabel>
                                <FormControl>
                                  <Input
                                    {...field}
                                    value={field.value || ""}
                                    placeholder="Optional"
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />

                          <FormField
                            control={form.control}
                            name={`allocations.${index}.receiptType`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Receipt Type</FormLabel>
                                <Select
                                  onValueChange={(value) => field.onChange(value === NO_SELECTION ? null : value)}
                                  value={field.value || NO_SELECTION}
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select type..." />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value={NO_SELECTION}>None</SelectItem>
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

                          <FormField
                            control={form.control}
                            name={`allocations.${index}.receiptIssued`}
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                                <div className="space-y-0.5">
                                  <FormLabel>Receipt Issued</FormLabel>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value || false}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>

                        {/* Notes */}
                        <FormField
                          control={form.control}
                          name={`allocations.${index}.notes`}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Notes (Optional)</FormLabel>
                              <FormControl>
                                <Textarea
                                  {...field}
                                  value={field.value || ""}
                                  placeholder="Add any notes for this allocation..."
                                  rows={2}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />

                        {/* Pledge Balance Information */}
                        {watchedAllocations?.[index]?.pledgeId && (
                          <div className="mt-4 p-3 bg-blue-50 rounded-md">
                            {(() => {
                              const pledgeOption = pledgeOptions.find(p => p.value === watchedAllocations[index].pledgeId);
                              const allocatedAmount = watchedAllocations[index]?.allocatedAmount || 0;
                              const paymentCurrency = watchedCurrency || payment.currency;
                              const pledgeCurrency = pledgeOption?.currency || paymentCurrency;

                              let amountInPledgeCurrency = allocatedAmount;
                              let exchangeRateToPledge = 1;

                              // Calculate conversion if currencies differ
                              if (paymentCurrency !== pledgeCurrency && exchangeRatesData?.data?.rates) {
                                const paymentRate = parseFloat(exchangeRatesData.data.rates[paymentCurrency]) || 1;
                                const pledgeRate = parseFloat(exchangeRatesData.data.rates[pledgeCurrency]) || 1;
                                exchangeRateToPledge = pledgeRate / paymentRate;
                                amountInPledgeCurrency = allocatedAmount * exchangeRateToPledge;
                              }

                              return (
                                <div className="text-sm space-y-1">
                                  <div className="font-medium text-blue-800 mb-2">
                                    Pledges/Donations Balance: {pledgeOption?.label || `Pledge #${watchedAllocations[index].pledgeId}`}
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Amount in Pledges/Donations Currency ({pledgeCurrency}):</span>
                                    <span className="font-medium">
                                      {pledgeCurrency} {amountInPledgeCurrency.toLocaleString()}
                                    </span>
                                  </div>
                                  {paymentCurrency !== pledgeCurrency && (
                                    <div className="flex justify-between text-xs text-blue-600">
                                      <span>Exchange Rate ({paymentCurrency} to {pledgeCurrency}):</span>
                                      <span>{exchangeRateToPledge.toFixed(4)}</span>
                                    </div>
                                  )}
                                  <div className="flex justify-between">
                                    <span>After allocation:</span>
                                    <span className="font-medium">
                                      {pledgeCurrency} {((pledgeOption?.balance || 0) - amountInPledgeCurrency).toLocaleString()}
                                    </span>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </Card>
                    ))}
                  </div>

                  {/* Add Allocation Button */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={addAllocation}
                    className="w-full flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add Another Allocation
                  </Button>

                  {/* Validation Messages */}
                  {!areAllocationsValid && (
                    <Alert className="border-red-200 bg-red-50">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-800">
                        Total allocated amount must equal payment amount.
                      </AlertDescription>
                    </Alert>
                  )}

                  {!areAllocationCurrenciesValid() && (
                    <Alert className="border-red-200 bg-red-50">
                      <AlertTriangle className="h-4 w-4 text-red-600" />
                      <AlertDescription className="text-red-800">
                        All allocation currencies must match the payment currency ({watchedCurrency || payment.currency}).
                      </AlertDescription>
                    </Alert>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Single Pledge Section */}
            {!watchedIsSplitPayment && (
              <Card>
                <CardHeader>
                  <CardTitle>Pledges/Donations Assignment</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="pledgeId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Pledges/Donations</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(value === NO_SELECTION ? null : parseInt(value))}
                          value={field.value?.toString() || NO_SELECTION}
                          disabled={isLoadingPledges || watchedIsThirdParty && !selectedThirdPartyContact}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select pledge..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NO_SELECTION}>None</SelectItem>
                            {pledgeOptions.map((option) => (
                              <SelectItem key={option.value} value={option.value.toString()}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Convert to Split Payment Option */}
                  {canConvertToSplit && !watchedIsThirdParty && (
                    <div className="flex items-center space-x-2">
                      <Switch
                        className="hidden"
                        id="split-payment"
                        checked={watchedIsSplitPayment}
                        onCheckedChange={handleSplitPaymentToggle}
                      />
                      <label htmlFor="split-payment" className="text-sm font-medium hidden">
                        Split this payment across multiple Pledges/Donations
                      </label>
                    </div>
                  )}

                  {/* Pledge Currency Conversion */}
                  {watchedPledgeId && selectedPledgeCurrency && selectedPledgeCurrency !== (watchedCurrency || payment.currency) && (
                    <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                      <div className="text-sm text-blue-700">
                        <p className="font-medium mb-2">Currency Conversion</p>
                        <div className="space-y-1">
                          <div className="flex justify-between">
                            <span>Payment Amount:</span>
                            <span className="font-medium">
                              {formatCurrency(watchedAmount || 0, watchedCurrency || payment.currency)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>Pledges/Donations Currency:</span>
                            <span className="font-medium">{selectedPledgeCurrency}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Amount in Pledges/Donations Currency:</span>
                            <span className="font-medium">
                              {formatCurrency(form.watch("amountInPledgeCurrency") || 0, selectedPledgeCurrency)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span>Exchange Rate:</span>
                            <span>{form.watch("exchangeRateToPledgeCurrency")?.toFixed(4) || "1.0000"}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Receipt Fields for Single Payment */}
                  <div className="grid grid-cols-3 gap-4">
                    <FormField
                      control={form.control}
                      name="receiptNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Receipt Number</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ""}
                              placeholder="Optional"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="receiptType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Receipt Type</FormLabel>
                          <Select
                            onValueChange={(value) => field.onChange(value === NO_SELECTION ? null : value)}
                            value={field.value || NO_SELECTION}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select type..." />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value={NO_SELECTION}>None</SelectItem>
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

                    <FormField
                      control={form.control}
                      name="receiptIssued"
                      render={({ field }) => (
                        <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                          <div className="space-y-0.5">
                            <FormLabel>Receipt Issued</FormLabel>
                          </div>
                          <FormControl>
                            <Switch
                              checked={field.value || false}
                              onCheckedChange={field.onChange}
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Payment Method and Details */}
            <Card>
              <CardHeader>
                <CardTitle>Payment Method & Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="paymentMethod"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Payment Method</FormLabel>
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
                                {isLoadingPaymentMethods
                                  ? "Loading payment methods..."
                                  : field.value
                                    ? paymentMethodOptions.find(method => method.value === field.value)?.label ||
                                    field.value.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())
                                    : "Select payment method"}
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
                                        const selectedMethod = paymentMethodOptions.find(m => m.value === value);
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
                                          method.value === field.value ? "opacity-100" : "opacity-0"
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
                                  {!watchedPaymentMethodRef.current
                                    ? "Select payment method first"
                                    : isLoadingDetailOptions
                                      ? "Loading details..."
                                      : field.value
                                        ? methodDetailOptions.find(detail => detail.value === field.value)?.label ||
                                        field.value.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())
                                        : "Select method detail"}
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
                                          const selectedDetail = methodDetailOptions.find(d => d.value === value);
                                          if (selectedDetail) {
                                            form.setValue("methodDetail", selectedDetail.value);
                                            setMethodDetailOpen(false);
                                          }
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-4 w-4",
                                            detail.value === field.value ? "opacity-100" : "opacity-0"
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
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="paymentStatus"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Payment Status</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select status..." />
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
                        <FormMessage />
                      </FormItem>
                    )}
                  />

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
                </div>

                {/* Check-specific fields */}
                {watchedPaymentMethod === "check" && (
                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="checkNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Check Number</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              value={field.value || ""}
                              placeholder="Enter check number"
                            />
                          </FormControl>
                          <FormMessage />
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
                            <Input
                              {...field}
                              type="date"
                              value={field.value || ""}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Solicitor Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  Solicitor Information
                  <Switch
                    checked={showSolicitorSection}
                    onCheckedChange={setShowSolicitorSection}
                  />
                </CardTitle>
              </CardHeader>
              {showSolicitorSection && (
                <CardContent className="space-y-4">
                  <FormField
                    control={form.control}
                    name="solicitorId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Solicitor</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(value === NO_SELECTION ? null : parseInt(value))}
                          value={field.value?.toString() || NO_SELECTION}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select solicitor..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NO_SELECTION}>None</SelectItem>
                            {solicitorOptions.map((solicitor) => (
                              <SelectItem key={solicitor.value} value={solicitor.value.toString()}>
                                {solicitor.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <FormField
                      control={form.control}
                      name="bonusPercentage"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bonus Percentage</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              step="0.01"
                              min="0"
                              max="100"
                              onChange={(e) => field.onChange(parseFloat(e.target.value) || undefined)}
                              value={field.value || ""}
                              placeholder="0.00"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="bonusAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Bonus Amount (Auto-calculated)</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="number"
                              step="0.01"
                              disabled
                              value={field.value || ""}
                              className="bg-gray-50"
                              placeholder="0.00"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              )}
            </Card>

            {/* Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      value={field.value || ""}
                      placeholder="Add any additional notes about this payment..."
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Submit Button */}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                onClick={() => {
                  console.log('Button clicked!');
                  console.log('Form errors:', form.formState.errors);
                  console.log('Form values:', form.getValues());
                  console.log('Form is valid:', form.formState.isValid);

                  // Fix the third-party validation issue for multi-contact payments
                  if (showMultiContactSection) {
                    // For multi-contact payments, clear third-party flags
                    form.setValue('isThirdPartyPayment', false);
                    form.setValue('thirdPartyContactId', null);
                  }

                  form.handleSubmit(onSubmit)();
                }}
                disabled={updatePaymentMutation.isPending}
              >
                {updatePaymentMutation.isPending ? "Updating..." : "Update Payment"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog >
  );
}
