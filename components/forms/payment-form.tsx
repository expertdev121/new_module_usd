/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useForm, useFieldArray } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, ChevronsUpDown, X, Plus, Users } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAccountsQuery } from "@/lib/query/accounts/useAccountsQuery";

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
import { useExchangeRates } from "@/lib/query/useExchangeRates";
import { usePaymentMethodOptions, usePaymentMethodDetailOptions } from "@/lib/query/usePaymentMethods";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useCreatePaymentMutation } from "@/lib/query/payments/usePaymentQuery";

// Define interfaces exactly like in edit form
interface Solicitor {
  id: number;
  firstName: string;
  lastName: string;
  commissionRate: number;
  contact?: any;
}

// Add the useSolicitors hook exactly like in edit form
const useSolicitors = (params: { search?: string; status?: string } = {}) => {
  return useQuery({
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

// Define literal tuples for enums
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

interface SolicitorOption {
  label: string;
  value: number;
  commissionRate?: number;
  contact?: any;
}

const paymentStatusValues = [
  "expected",
  "pending",
  "completed",
  "refund",
  "returned",
  "declined",
] as const;

const receiptTypeValues = ["invoice", "confirmation", "receipt", "other"] as const;

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

// Allocation schema with receipt fields per allocation
const allocationSchema = z.object({
  pledgeId: z.number().positive(),
  amount: z.number().nonnegative(),
  installmentScheduleId: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  receiptNumber: z.string().optional().nullable(),
  receiptType: z.enum(receiptTypeValues).optional().nullable(),
  receiptIssued: z.boolean().optional(),
});

// Payment schema
const paymentSchema = z.object({
  pledgeId: z.number().optional().nullable(),
  amount: z.number().nonnegative(),
  currency: z.enum(supportedCurrencies),
  amountUsd: z.number().nonnegative(),
  exchangeRate: z.number().positive(),
  paymentDate: z.string(),
  receivedDate: z.string().optional().nullable(),
  paymentMethod: z.string(),
  methodDetail: z.string().optional().nullable(),
  accountId: z.number().optional().nullable(),
  checkDate: z.string().optional().nullable(),
  checkNumber: z.string().optional().nullable(),
  paymentStatus: z.enum(paymentStatusValues).optional(),
  solicitorId: z.number().optional().nullable(),
  bonusPercentage: z.number().optional().nullable(),
  bonusAmount: z.number().optional().nullable(),
  bonusRuleId: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
  isSplitPayment: z.boolean().optional(),
  allocations: z.array(allocationSchema).optional(),
});

type PaymentFormData = z.infer<typeof paymentSchema>;

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pledgeId?: number;
  pledgeAmount?: number;
  pledgeCurrency?: typeof supportedCurrencies[number];
  pledgeDescription?: string;
  onPaymentCreated?: () => void;
}

export default function PaymentDialog({
  open,
  onOpenChange,
  pledgeId,
  pledgeAmount = 0,
  pledgeCurrency = "USD",
  pledgeDescription = "",
  onPaymentCreated,
}: PaymentDialogProps) {
  console.log('=== PAYMENT DIALOG RENDERED ===', { open, pledgeId });

  const createPaymentMutation = useCreatePaymentMutation();

  const [showSolicitorSection, setShowSolicitorSection] = useState(false);

  // FIXED: Move these useState hooks to the top level
  const [paymentMethodOpen, setPaymentMethodOpen] = useState(false);
  const [methodDetailOpen, setMethodDetailOpen] = useState(false);

  const [pledgeExchangeRate, setPledgeExchangeRate] = useState(1);
  const [pledgeUsdAmount, setPledgeUsdAmount] = useState(0);
  const [pledgeExchangeRateToPledgeCurrency, setPledgeExchangeRateToPledgeCurrency] = useState(1);
  const [amountInPledgeCurrency, setAmountInPledgeCurrency] = useState(0);

  console.log('Show solicitor section:', showSolicitorSection);

  // Use the same solicitors fetching pattern as edit form
  const { data: solicitorsData } = useSolicitors({ status: "active" });

  console.log('=== SOLICITOR DEBUG ===');
  console.log('Solicitors data:', solicitorsData);
  console.log('Is solicitors data loading?');
  console.log('Raw solicitors array:', solicitorsData?.solicitors);

  const form = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      pledgeId: pledgeId ?? null,
      amount: pledgeAmount,
      currency: pledgeCurrency,
      amountUsd: 0,
      exchangeRate: 1,
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
      notes: "",
      isSplitPayment: false,
      allocations: [
        {
          pledgeId: pledgeId ?? 0,
          amount: pledgeAmount,
          installmentScheduleId: null,
          notes: null,
          receiptNumber: null,
          receiptType: null,
          receiptIssued: false,
        },
      ],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "allocations",
  });
  const { data: accountsData, isLoading: isLoadingAccounts } = useAccountsQuery();

  // Watches
  const watchedCurrency = form.watch("currency");
  const watchedAmount = form.watch("amount");
  const watchedExchangeRate = form.watch("exchangeRate");
  const watchedIsSplitPayment = form.watch("isSplitPayment");
  const watchedAllocations = form.watch("allocations");
  const watchedPaymentDate = form.watch("paymentDate");
  const watchedPaymentMethod = form.watch("paymentMethod");

  const {
    data: exchangeRatesData,
    isLoading: isLoadingRates,
    error: ratesError,
  } = useExchangeRates(watchedPaymentDate);

  // Get dynamic payment methods and details
  const { options: paymentMethodOptions, isLoading: isLoadingPaymentMethods } = usePaymentMethodOptions();
  const { options: methodDetailOptions, isLoading: isLoadingMethodDetails } = usePaymentMethodDetailOptions(watchedPaymentMethod);

  const solicitorOptions: SolicitorOption[] = solicitorsData?.solicitors?.map((solicitor: Solicitor) => ({
    label: `${solicitor.firstName} ${solicitor.lastName}`,
    value: solicitor.id,
    commissionRate: solicitor.commissionRate,
    contact: solicitor.contact,
  })) || [];

  console.log('Solicitor options after mapping:', solicitorOptions);

  // Update exchange rate when currency changes
  useEffect(() => {
    if (watchedCurrency && exchangeRatesData?.data?.rates) {
      const rate = parseFloat(exchangeRatesData.data.rates[watchedCurrency]) || 1;
      form.setValue("exchangeRate", rate);
    }
  }, [watchedCurrency, exchangeRatesData, form]);

  // Update amountUsd when amount or exchange rate changes
  useEffect(() => {
    const rate = form.getValues("exchangeRate") || 1;
    if (watchedAmount && rate) {
      const usdAmount = watchedAmount / rate;
      form.setValue("amountUsd", Math.round(usdAmount * 100) / 100);
    }
  }, [watchedAmount, watchedExchangeRate, form]);

  // Calculate pledge exchange rate and USD amount
  useEffect(() => {
    if (pledgeCurrency && exchangeRatesData?.data?.rates) {
      const rate = parseFloat(exchangeRatesData.data.rates[pledgeCurrency]) || 1;
      setPledgeExchangeRate(rate);
      if (pledgeAmount) {
        const usd = pledgeAmount / rate;
        setPledgeUsdAmount(Math.round(usd * 100) / 100);
      }
    }
  }, [pledgeCurrency, pledgeAmount, exchangeRatesData]);

  // Calculate pledge exchange rate to pledge currency and amount in pledge currency
  useEffect(() => {
    if (pledgeCurrency && watchedCurrency && exchangeRatesData?.data?.rates) {
      const pledgeRate = parseFloat(exchangeRatesData.data.rates[pledgeCurrency]) || 1;
      const paymentRate = parseFloat(exchangeRatesData.data.rates[watchedCurrency]) || 1;

      // Corrected: Exchange rate from pledge currency to payment currency (invert)
      const exchangeRateToPledge = pledgeRate / paymentRate;
      setPledgeExchangeRateToPledgeCurrency(Math.round(exchangeRateToPledge * 1000000) / 1000000);

      // Amount in pledge currency
      if (watchedAmount) {
        const amountInPledge = watchedAmount * exchangeRateToPledge;
        setAmountInPledgeCurrency(Math.round(amountInPledge * 100) / 100);
      }
    }
  }, [pledgeCurrency, watchedCurrency, watchedAmount, exchangeRatesData]);

  // Validate allocations sum equals amount
  const totalAllocated = (watchedAllocations || []).reduce(
    (sum, alloc) => sum + (alloc.amount || 0),
    0,
  );
  const allocationsValid =
    !watchedIsSplitPayment || Math.abs(totalAllocated - (watchedAmount || 0)) < 0.01;

  // Sanitize nullable string fields before submit
  const sanitizeNullable = (value: any) => (value === null || value === "" ? undefined : value);

  // Submit handler
  const onSubmit = async (data: PaymentFormData) => {
    if (watchedIsSplitPayment && !allocationsValid) {
      toast.error("Total allocated amount must equal payment amount.");
      return;
    }

    try {
      // Convert accountId to account name
      let accountName: string | null = null;
      if (data.accountId) {
        const selectedAccount = accountsData?.find((acc) => acc.id === data.accountId);
        accountName = selectedAccount?.name || null;
      }

      const payload: any = {
        ...data,
        account: accountName, // Send account name instead of accountId
        receivedDate: sanitizeNullable(data.receivedDate),
        methodDetail: sanitizeNullable(data.methodDetail),
        // Remove accountId from payload since we're using account name
        accountId: undefined,
        checkDate: sanitizeNullable(data.checkDate),
        checkNumber: sanitizeNullable(data.checkNumber),
        notes: sanitizeNullable(data.notes),
        solicitorId: data.solicitorId ?? undefined,
        bonusPercentage: data.bonusPercentage ?? undefined,
        bonusAmount: data.bonusAmount ?? undefined,
        bonusRuleId: data.bonusRuleId ?? undefined,
        allocations: data.allocations?.map((alloc) => ({
          ...alloc,
          receiptNumber: sanitizeNullable(alloc.receiptNumber),
          receiptType: sanitizeNullable(alloc.receiptType),
          installmentScheduleId: alloc.installmentScheduleId ?? undefined,
        })),
      };

      // Handle pledgeId and allocations based on split payment mode
      if (!data.isSplitPayment) {
        if (data.pledgeId == null) {
          throw new Error("pledgeId is required when not split payment");
        }
        payload.pledgeId = data.pledgeId;
        // Remove allocations for non-split payments
        delete payload.allocations;
      } else {
        delete payload.pledgeId;
      }

      await createPaymentMutation.mutateAsync(payload);

      toast.success("Payment created successfully");
      form.reset();
      setShowSolicitorSection(false);
      onOpenChange(false);
      onPaymentCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create payment");
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    onOpenChange(newOpen);
    if (!newOpen) {
      form.reset();
      setShowSolicitorSection(false);
    }
  };

  // Add allocation
  const addAllocation = () => {
    append({
      pledgeId: 0,
      amount: 0,
      installmentScheduleId: null,
      notes: null,
      receiptNumber: null,
      receiptType: null,
      receiptIssued: false,
    });
  };

  // Remove allocation
  const removeAllocation = (index: number) => remove(index);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Payment</DialogTitle>
          <DialogDescription>
            Record a payment for Pledges/Donations: {pledgeDescription || `#${pledgeId ?? "-"}`}
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" noValidate>
            {/* Pledge Details */}
            {pledgeId && (
              <Card>
                <CardHeader>
                  <CardTitle>Pledges/Donations Details</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Pledges/Donations Amount</label>
                    <Input value={`${pledgeAmount} ${pledgeCurrency}`} readOnly />
                  </div>
                  <div className="hidden">
                    <label className="text-sm font-medium">Pledges/Donations Exchange Rate</label>
                    <Input value={`1 ${pledgeCurrency} = ${(1 / pledgeExchangeRate).toFixed(6)} USD`} readOnly />
                  </div>
                  <div className="md:col-span-2 hidden">
                    <label className="text-sm font-medium">Pledges/Donations Amount (USD)</label>
                    <Input value={pledgeUsdAmount} readOnly />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Payment Details */}
            <Card>
              <CardHeader>
                <CardTitle>Payment Details</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Amount</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="number"
                          step="0.01"
                          min={0}
                          value={field.value ?? ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            field.onChange(val ? parseFloat(val) : 0);
                          }}
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
                        <Select value={field.value} onValueChange={field.onChange}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select currency" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {supportedCurrencies.map((curr) => (
                              <SelectItem key={curr} value={curr}>
                                {curr}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {ratesError && (
                          <p className="text-sm text-red-600">Error fetching rates.</p>
                        )}
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
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
                          <Input type="number" step="0.0001" min={0} readOnly value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="hidden">
                  <FormField
                    control={form.control}
                    name="amountUsd"
                    render={({ field }) => (
                      <FormItem className="hidden">
                        <FormLabel>Amount (USD)</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min={0} readOnly value={field.value ?? ""} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                {/* New fields for exchange rate to pledge currency and amount in pledge currency */}
                <div className="hidden">
                  <FormItem>
                    <FormLabel>Exchange Rate (1 {watchedCurrency} = {pledgeExchangeRateToPledgeCurrency} {pledgeCurrency})</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.000001" min={0} readOnly value={pledgeExchangeRateToPledgeCurrency} />
                    </FormControl>
                  </FormItem>
                  <FormItem>
                    <FormLabel>Amount ({pledgeCurrency})</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min={0} readOnly value={amountInPledgeCurrency} />
                    </FormControl>
                  </FormItem>
                </div>
                <FormField
                  control={form.control}
                  name="paymentDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Payment Date</FormLabel>
                      <FormControl>
                        <DateInput value={field.value} onChange={field.onChange} />
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
                      <FormLabel>Effective Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ""} onChange={(e) => {
                          const value = e.target.value;
                          if (value) {
                            const parts = value.split("-");
                            if (parts[0] && parts[0].length > 4) {
                              return;
                            }
                          }
                          field.onChange(value);
                        }} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Payment Method & Status */}
            <Card>
              <CardHeader>
                <CardTitle>Payment Method & Status</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="paymentMethod"
                  render={({ field }) => {
                    // FIXED: Removed useState from inside render function
                    return (
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
                            <Command>
                              <CommandInput placeholder="Search payment method..." />
                              <CommandEmpty>No payment method found.</CommandEmpty>
                              <CommandList>
                                <CommandGroup className="max-h-[300px] overflow-y-auto">
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
                                          form.setValue("methodDetail", undefined);
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
                    );
                  }}
                />
                <div className="hidden">
                  <FormField
                    control={form.control}
                    name="methodDetail"
                    render={({ field }) => {
                      // FIXED: Removed useState from inside render function
                      return (
                        <FormItem className="flex flex-col">
                          <FormLabel>Method Detail</FormLabel>
                          <Popover open={methodDetailOpen} onOpenChange={setMethodDetailOpen}>
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  aria-expanded={methodDetailOpen}
                                  disabled={!watchedPaymentMethod || isLoadingMethodDetails}
                                  className={cn(
                                    "w-full justify-between",
                                    !field.value && "text-muted-foreground"
                                  )}
                                >
                                  {!watchedPaymentMethod ? (
                                    "Select payment method first"
                                  ) : isLoadingMethodDetails ? (
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
                              <Command>
                                <CommandInput placeholder="Search method detail..." />
                                <CommandEmpty>
                                  {methodDetailOptions.length === 0
                                    ? "No method details available for this payment method."
                                    : "No method detail found."}
                                </CommandEmpty>
                                <CommandList>
                                  <CommandGroup className="max-h-[300px] overflow-y-auto">
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
                      );
                    }}
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
                  name="checkDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Check Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} value={field.value ?? ""} onChange={(e) => {
                          const value = e.target.value;
                          if (value) {
                            const parts = value.split("-");
                            if (parts[0] && parts[0].length > 4) {
                              return;
                            }
                          }
                          field.onChange(value);
                        }} />
                      </FormControl>
                      <FormMessage />
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
                      <Select value={field.value ?? ""} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select payment status" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {paymentStatusValues.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            {/* Solicitor Section */}
            {/* <div className="flex items-center space-x-2">
              <Switch
                id="show-solicitor-section"
                checked={showSolicitorSection}
                onCheckedChange={(checked) => {
                  setShowSolicitorSection(checked);
                  if (!checked) {
                    form.setValue("solicitorId", null);
                    form.setValue("bonusPercentage", null);
                    form.setValue("bonusAmount", null);
                    form.setValue("bonusRuleId", null);
                  }
                }}
              />
              <label htmlFor="show-solicitor-section" className="text-sm font-medium">
                Assign Solicitor
              </label>
            </div>
            {showSolicitorSection && (
              <Card>
                <CardHeader>
                  <CardTitle>Solicitor Information</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="solicitorId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Solicitor</FormLabel>
                        <Select
                          onValueChange={(value) => field.onChange(value === NO_SELECTION ? null : parseInt(value))}
                          value={field.value?.toString() ?? NO_SELECTION}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Select solicitor..." />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value={NO_SELECTION}>None</SelectItem>
                            {solicitorOptions.map((solicitor: SolicitorOption) => (
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
                  <FormField
                    control={form.control}
                    name="bonusPercentage"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bonus Percentage (%)</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            step="0.01"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(e.target.value ? Number(e.target.value) : null)
                            }
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
                        <FormLabel>Bonus Amount</FormLabel>
                        <FormControl>
                          <Input
                            type="number"
                            step="0.01"
                            value={field.value ?? ""}
                            disabled
                            onChange={field.onChange}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="bonusRuleId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Bonus Rule ID</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            type="number"
                            value={field.value ?? ""}
                            onChange={(e) =>
                              field.onChange(e.target.value ? Number(e.target.value) : null)
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>
            )} */}

            {/* Split Payment Toggle */}
            {/* <div className="flex items-center space-x-2">
              <FormField
                control={form.control}
                name="isSplitPayment"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center space-x-3 space-y-0">
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                      />
                    </FormControl>
                    <div className="space-y-1 leading-none">
                      <FormLabel>Split Payment</FormLabel>
                    </div>
                  </FormItem>
                )}
              />
            </div> */}

            {/* Split Payment Allocations */}
            {watchedIsSplitPayment && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Payment Allocations
                    <span className="ml-2 rounded bg-gray-200 px-2 text-xs">
                      {fields.length} allocation{fields.length !== 1 ? "s" : ""}
                    </span>
                  </CardTitle>
                  <DialogDescription>
                    Add allocation amounts for this split payment. All allocations must use the same currency as the payment.
                  </DialogDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {fields.length > 0 ? (
                    fields.map((field, index) => (
                      <div
                        key={field.id}
                        className="border border-gray-300 rounded-lg p-6 bg-white shadow-sm hover:shadow-md"
                      >
                        <div className="flex justify-between mb-4">
                          <h4 className="font-semibold text-lg">Allocation #{index + 1}</h4>
                          {fields.length > 1 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-800"
                              aria-label={`Remove allocation ${index + 1}`}
                              onClick={() => removeAllocation(index)}
                            >
                              <X className="h-5 w-5" />
                            </Button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.pledgeId`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Pledges/Donations ID *</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    value={field.value ?? ""}
                                    onChange={(e) =>
                                      field.onChange(
                                        e.target.value ? parseInt(e.target.value) : null,
                                      )
                                    }
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.amount`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Allocated Amount *</FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    value={field.value ?? ""}
                                    onChange={(e) =>
                                      field.onChange(
                                        e.target.value ? parseFloat(e.target.value) : null,
                                      )
                                    }
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.notes`}
                            render={({ field }) => (
                              <FormItem className="md:col-span-2">
                                <FormLabel>Allocation Notes</FormLabel>
                                <FormControl>
                                  <Textarea
                                    rows={2}
                                    value={field.value ?? ""}
                                    onChange={(e) => field.onChange(e.target.value)}
                                  />
                                </FormControl>
                                <FormMessage />
                              </FormItem>
                            )}
                          />
                          <FormField
                            control={form.control}
                            name={`allocations.${index}.receiptNumber`}
                            render={({ field }) => (
                              <FormItem>
                                <FormLabel>Receipt Number</FormLabel>
                                <FormControl>
                                  <Input value={field.value ?? ""} onChange={field.onChange} />
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
                                  value={field.value ?? NO_SELECTION}
                                  onValueChange={(val) =>
                                    field.onChange(val === NO_SELECTION ? null : val)
                                  }
                                >
                                  <FormControl>
                                    <SelectTrigger>
                                      <SelectValue placeholder="Select receipt type" />
                                    </SelectTrigger>
                                  </FormControl>
                                  <SelectContent>
                                    <SelectItem value={NO_SELECTION}>None</SelectItem>
                                    {receiptTypeValues.map((type) => (
                                      <SelectItem key={type} value={type}>
                                        {type}
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
                              <FormItem className="flex justify-between items-center md:col-span-2 rounded-lg border p-4 shadow-sm">
                                <FormLabel>Receipt Issued</FormLabel>
                                <FormControl>
                                  <Switch
                                    checked={!!field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-center p-4 text-muted-foreground">
                      No allocations yet.
                    </p>
                  )}
                  <Button type="button" variant="outline" onClick={addAllocation} className="flex items-center gap-2">
                    <Plus className="h-4 w-4" /> Add Allocation
                  </Button>

                  {/* Allocation summary and validation */}
                  <div className="mt-4 border-t pt-4">
                    <div className="flex justify-between font-semibold text-lg">
                      <span>Total Allocated:</span>
                      <span>
                        {watchedCurrency}{" "}
                        {totalAllocated.toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm text-muted-foreground mt-1">
                      <span>Payment Amount:</span>
                      <span>
                        {watchedCurrency}{" "}
                        {(watchedAmount ?? 0).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                    {!allocationsValid && (
                      <p className="mt-2 text-red-600 font-medium">
                        Total allocated amount must equal payment amount.
                      </p>
                    )}
                    {allocationsValid && (
                      <p className="mt-2 text-green-600 font-medium">
                        Allocations are balanced.
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* General Notes */}
            <FormField
              control={form.control}
              name="notes"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>General Payment Notes</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Action Buttons */}
            <div className="flex gap-4 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={createPaymentMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  createPaymentMutation.isPending ||
                  isLoadingRates ||
                  (watchedIsSplitPayment && !allocationsValid)
                }
                className="bg-green-600 hover:bg-green-700"
              >
                {createPaymentMutation.isPending ? "Creating..." : "Record Payment"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
