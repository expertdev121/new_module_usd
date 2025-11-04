/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Check, ChevronsUpDown } from "lucide-react";
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
import { useExchangeRates } from "@/lib/query/useExchangeRates";
import { usePaymentMethodOptions, usePaymentMethodDetailOptions } from "@/lib/query/usePaymentMethods";
import { useContactQuery } from "@/lib/query/useContactDetails";
import { useAccountsQuery } from "@/lib/query/accounts/useAccountsQuery";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ManualDonation } from "@/lib/types/manual-donations";

// Define interfaces exactly like in payment form
interface Solicitor {
  id: number;
  firstName: string;
  lastName: string;
  commissionRate: number;
  contact?: any;
}

// Add the useSolicitors hook exactly like in payment form
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



const NO_SELECTION = "__NONE__"; // Sentinel for 'None' selection for Select components

// Manual donation schema based on the manual_donation table
const manualDonationSchema = z.object({
  contactId: z.number().positive("Contact is required"),
  amount: z.number().nonnegative("Amount must be positive"),
  currency: z.enum(supportedCurrencies),
  amountUsd: z.number().nonnegative(),
  exchangeRate: z.number().positive(),
  paymentDate: z.string().optional(),
  receivedDate: z.string().optional().nullable(),
  checkDate: z.string().optional().nullable(),
  account: z.string().optional().nullable(),
  paymentMethod: z.string(),
  methodDetail: z.string().optional().nullable(),
  paymentStatus: z.enum(paymentStatusValues).optional(),
  referenceNumber: z.string().optional().nullable(),
  checkNumber: z.string().optional().nullable(),
  receiptNumber: z.string().optional().nullable(),
  receiptType: z.enum(receiptTypeValues).optional().nullable(),
  receiptIssued: z.boolean().optional(),
  solicitorId: z.number().optional().nullable(),
  bonusPercentage: z.number().optional().nullable(),
  bonusAmount: z.number().optional().nullable(),
  bonusRuleId: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

type ManualDonationFormData = z.infer<typeof manualDonationSchema>;

interface ManualPaymentFormProps {
  contactId?: number;
  manualDonation?: ManualDonation;
  isEditing?: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
}

export default function ManualPaymentForm({
  contactId,
  manualDonation,
  isEditing = false,
  onSuccess,
  onCancel,
}: ManualPaymentFormProps) {
  const [paymentMethodOpen, setPaymentMethodOpen] = useState(false);
  const [methodDetailOpen, setMethodDetailOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSolicitorFields, setShowSolicitorFields] = useState(false);

  // Use the same solicitors fetching pattern as payment form
  const { data: solicitorsData } = useSolicitors({ status: "active" });

  // Fetch contact details if contactId is provided
  const { data: contactData, isLoading: isLoadingContact } = useContactQuery({ contactId: contactId || 0 });

  const form = useForm<ManualDonationFormData>({
    resolver: zodResolver(manualDonationSchema),
    defaultValues: {
      contactId: contactId ?? 0,
      amount: 0,
      currency: "USD",
      amountUsd: 0,
      exchangeRate: 1,
      paymentDate: new Date().toISOString().split("T")[0],
      receivedDate: null,
      checkDate: null,
      account: "",
      paymentMethod: "cash",
      methodDetail: undefined,
      paymentStatus: "completed",
      referenceNumber: null,
      checkNumber: null,
      receiptNumber: null,
      receiptType: null,
      receiptIssued: false,
      solicitorId: null,
      bonusPercentage: null,
      bonusAmount: null,
      bonusRuleId: null,
      notes: "",
    },
  }); 

  // Populate form when editing
  useEffect(() => {
    if (isEditing && manualDonation) {
      form.reset({
        contactId: manualDonation.contactId,
        amount: parseFloat(manualDonation.amount),
        currency: manualDonation.currency as (typeof supportedCurrencies)[number],
        amountUsd: parseFloat(manualDonation.amountUsd || '0'),
        exchangeRate: parseFloat(manualDonation.exchangeRate || '1'),
        paymentDate: manualDonation.paymentDate,
        receivedDate: manualDonation.receivedDate || null,
        checkDate: manualDonation.checkDate || null,
        account: manualDonation.account || "",
        paymentMethod: manualDonation.paymentMethod,
        methodDetail: manualDonation.methodDetail || undefined,
        paymentStatus: manualDonation.paymentStatus as (typeof paymentStatusValues)[number],
        referenceNumber: manualDonation.referenceNumber || null,
        checkNumber: manualDonation.checkNumber || null,
        receiptNumber: manualDonation.receiptNumber || null,
        receiptType: manualDonation.receiptType as (typeof receiptTypeValues)[number] | null,
        receiptIssued: manualDonation.receiptIssued,
        solicitorId: manualDonation.solicitorId,
        bonusPercentage: manualDonation.bonusPercentage ? parseFloat(manualDonation.bonusPercentage) : null,
        bonusAmount: manualDonation.bonusAmount ? parseFloat(manualDonation.bonusAmount) : null,
        bonusRuleId: manualDonation.bonusRuleId,
        notes: manualDonation.notes || "",
      });
      setShowSolicitorFields(!!manualDonation.solicitorId);
    }
  }, [isEditing, manualDonation, form]);

  // Watches
  const watchedCurrency = form.watch("currency");
  const watchedAmount = form.watch("amount");
  const watchedExchangeRate = form.watch("exchangeRate");
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

  // Get dynamic accounts
  const { data: accountsData, isLoading: isLoadingAccounts } = useAccountsQuery();

  const solicitorOptions: SolicitorOption[] = solicitorsData?.solicitors?.map((solicitor: Solicitor) => ({
    label: `${solicitor.firstName} ${solicitor.lastName}`,
    value: solicitor.id,
    commissionRate: solicitor.commissionRate,
    contact: solicitor.contact,
  })) || [];

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

  // Clear solicitor fields when toggle is turned off
  useEffect(() => {
    if (!showSolicitorFields) {
      form.setValue("solicitorId", null);
      form.setValue("bonusPercentage", null);
      form.setValue("bonusAmount", null);
      form.setValue("bonusRuleId", null);
    }
  }, [showSolicitorFields, form]);

  // Sanitize nullable string fields before submit
  const sanitizeNullable = (value: any) => (value === null || value === "" ? undefined : value);

  // Submit handler
  const onSubmit = async (data: ManualDonationFormData) => {
    if (isSubmitting) return; // Prevent multiple submissions

    setIsSubmitting(true);
    try {
      const payload = {
        ...data,
        receivedDate: sanitizeNullable(data.receivedDate),
        checkDate: sanitizeNullable(data.checkDate),
        account: sanitizeNullable(data.account),
        methodDetail: sanitizeNullable(data.methodDetail),
        referenceNumber: sanitizeNullable(data.referenceNumber),
        checkNumber: sanitizeNullable(data.checkNumber),
        receiptNumber: sanitizeNullable(data.receiptNumber),
        receiptType: sanitizeNullable(data.receiptType),
        notes: sanitizeNullable(data.notes),
        solicitorId: data.solicitorId ?? undefined,
        bonusPercentage: data.bonusPercentage ?? undefined,
        bonusAmount: data.bonusAmount ?? undefined,
        bonusRuleId: data.bonusRuleId ?? undefined,
      };

      const method = isEditing ? "PUT" : "POST";
      const url = isEditing ? `/api/manual-donations/${manualDonation?.id}` : "/api/manual-donations";

      const response = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Failed to ${isEditing ? 'update' : 'create'} manual donation`);
      }

      toast.success(`Manual donation ${isEditing ? 'updated' : 'created'} successfully`);
      if (!isEditing) {
        form.reset();
        setShowSolicitorFields(false);
      }
      onSuccess?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Failed to ${isEditing ? 'update' : 'create'} manual donation`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Contact Information */}
        <Card>
          <CardHeader>
            <CardTitle>Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {contactId ? (
              <>
                {contactData?.contact ? (
                  <div className="text-sm text-gray-600">
                    <strong>Contact:</strong> {contactData.contact.firstName} {contactData.contact.lastName}
                  </div>
                ) : isLoadingContact ? (
                  <div className="text-sm text-gray-500">Loading contact details...</div>
                ) : (
                  <div className="text-sm text-gray-600">
                    <strong>Contact ID:</strong> {contactId}
                  </div>
                )}
              </>
            ) : (
              <FormField
                control={form.control}
                name="contactId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact *</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        {...field}
                        value={field.value ?? ""}
                        onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value) : 0)}
                        disabled={!!contactId}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </CardContent>
        </Card>

        {/* Donation Details */}
        <Card>
          <CardHeader>
            <CardTitle>Donation Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount *</FormLabel>
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
                  <FormLabel>Currency *</FormLabel>
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
                  <FormItem>
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
                  <FormItem>
                    <FormLabel>Amount (USD)</FormLabel>
                    <FormControl>
                      <Input type="number" step="0.01" min={0} readOnly value={field.value ?? ""} />
                    </FormControl>
                    <FormMessage />
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
                    <DateInput {...field} />
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
                  <FormLabel>Received Date</FormLabel>
                  <FormControl>
                    <DateInput {...field} />
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
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="account"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormLabel>Account</FormLabel>
                  <Select value={field.value ?? ""} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger disabled={isLoadingAccounts}>
                        <SelectValue placeholder={isLoadingAccounts ? "Loading accounts..." : "Select account"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {accountsData?.map((account) => (
                        <SelectItem key={account.id} value={account.name}>
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
            <FormField
              control={form.control}
              name="checkDate"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Check Date</FormLabel>
                  <FormControl>
                    <DateInput {...field} />
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
              name="referenceNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Reference Number</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Receipt Information */}
        <Card>
          <CardHeader>
            <CardTitle>Receipt Information</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField
              control={form.control}
              name="receiptNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Receipt Number</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value ?? ""} />
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
              name="receiptIssued"
              render={({ field }) => (
                <FormItem className="flex justify-between items-center md:col-span-2 rounded-lg border p-4 shadow-sm">
                  <FormLabel>Receipt Issued</FormLabel>
                  <FormControl>
                    <input
                      type="checkbox"
                      checked={field.value || false}
                      onChange={field.onChange}
                      className="h-4 w-4"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Solicitor Information */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Solicitor Information</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600">
                  {showSolicitorFields ? "Hide" : "Show"} Solicitor Fields
                </span>
                <button
                  type="button"
                  onClick={() => setShowSolicitorFields(!showSolicitorFields)}
                  className={cn(
                    "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500",
                    showSolicitorFields ? "bg-blue-600" : "bg-gray-200"
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      showSolicitorFields ? "translate-x-6" : "translate-x-1"
                    )}
                  />
                </button>
              </div>
            </div>
          </CardHeader>
          {showSolicitorFields && (
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
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isLoadingRates || isSubmitting}
            className="bg-green-600 hover:bg-green-700"
          >
            {isSubmitting
              ? (isEditing ? "Updating..." : "Creating...")
              : (isEditing ? "Update Manual Donation" : "Create Manual Donation")
            }
          </Button>
        </div>
      </form>
    </Form>
  );
}