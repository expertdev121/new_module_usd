/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable react-hooks/exhaustive-deps */
"use client";

import React from "react";
import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Check, ChevronsUpDown, PlusCircle, Edit, X } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useExchangeRates } from "@/lib/query/useExchangeRates";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  useCreatePledgeMutation,
  useCreatePledgeAndPayMutation,
  useUpdatePledgeMutation,
} from "@/lib/query/pledge/usePledgeQuery";
import { useTagsQuery } from "@/lib/query/tags/useTagsQuery";
import { useCampaigns, useCreateCampaign } from "@/lib/query/useCampaigns";
import { useCreateCategory } from "@/lib/query/useCategories";
import PaymentDialog from "./payment-form";
import { getCategoryItems, CategoryItem } from "@/lib/data/categories";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";

// Tag interface
interface Tag {
  id: number;
  name: string;
  description: string | null;
  showOnPledge: boolean;
  showOnPayment: boolean;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

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

import { useCategories } from "@/lib/query/useCategories";

// Static categories for display
// Removed static categories to use dynamic categories from props
// const STATIC_CATEGORIES = [
//   { id: 1, name: "Donation", description: "General donations" },
//   { id: 2, name: "Tuition", description: "Educational tuition fees" },
//   { id: 3, name: "Miscellaneous", description: "Miscellaneous fees and charges" },
// ];

const pledgeSchema = z.object({
  contactId: z.number().positive("Contact ID is required"),
  categoryId: z.number().positive("Please select a category").optional(),
  description: z.string().optional(),
  pledgeDate: z.string().min(1, "Pledges date is required"),
  currency: z.enum(supportedCurrencies, {
    errorMap: () => ({ message: "Please select a valid currency" }),
  }),
  originalAmount: z
    .number()
    .positive("Pledges amount must be greater than 0")
    .min(0.01, "Pledges amount must be at least 0.01"),
  originalAmountUsd: z
    .number()
    .positive("USD amount must be greater than 0")
    .min(0.01, "USD amount must be at least 0.01"),
  exchangeRate: z
    .number()
    .positive("Exchange rate must be greater than 0")
    .min(0.0001, "Exchange rate must be at least 0.0001"),
  exchangeRateDate: z.string().optional(),
  campaignCode: z.string().optional(),
  notes: z.string().optional(),
  tagIds: z.array(z.number()).optional(),
});

// Add categories prop to accept dynamic categories
interface PledgeFormProps {
  contactId: number;
  contactName?: string;
  mode?: "create" | "edit";
  pledgeData?: any;
  onPledgeCreated?: (pledgeId: number) => void;
  onPledgeCreatedAndPay?: (pledgeId: number) => void;
  onPledgeUpdated?: (pledgeId: number) => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  categories?: Array<{ id: number; name: string; description?: string | null }>;
}

type PledgeFormData = z.infer<typeof pledgeSchema>;

// UPDATED: Support both direct pledge data and full API response structure
interface PledgeData {
  id?: number;
  contactId?: number;
  description?: string;
  pledgeDate?: string;
  currency?: string;
  originalAmount?: number;
  originalAmountUsd?: number;
  exchangeRate?: number;
  campaignCode?: string;
  notes?: string;
  category?: {
    id: number;
    name: string;
    description: string;
  };
  tags?: Array<{
    id: number;
    name: string;
    description: string;
    showOnPayment: boolean;
    showOnPledge: boolean;
    isActive: boolean;
  }>;
  // Support for full API response structure
  pledge?: {
    id?: number;
    contactId?: number;
    description?: string;
    pledgeDate?: string;
    currency?: string;
    originalAmount?: number;
    originalAmountUsd?: number;
    exchangeRate?: number;
    campaignCode?: string;
    notes?: string;
  };
}

interface PledgeDialogProps {
  contactId: number;
  contactName?: string;
  mode?: "create" | "edit";
  pledgeData?: any; // Allow any structure to handle different API response formats
  onPledgeCreated?: (pledgeId: number) => void;
  onPledgeCreatedAndPay?: (pledgeId: number) => void;
  onPledgeUpdated?: (pledgeId: number) => void;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  categories?: Array<{ id: number; name: string; description?: string | null }>;
}

export default function PledgeDialog({
  contactId,
  contactName,
  mode = "create",
  pledgeData: rawPledgeData,
  onPledgeCreated,
  onPledgeCreatedAndPay,
  onPledgeUpdated,
  trigger,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  categories = [],
}: PledgeDialogProps) {

  // ENHANCED: Normalize pledge data structure
  const pledgeData = React.useMemo(() => {
    if (!rawPledgeData) return null;

    // Handle full API response structure (has pledge, tags, category at root)
    if (rawPledgeData.pledge && rawPledgeData.tags !== undefined) {
      return {
        ...rawPledgeData.pledge,
        category: rawPledgeData.category,
        tags: rawPledgeData.tags || [],
      };
    }

    // Handle direct pledge data structure
    return rawPledgeData;
  }, [rawPledgeData]);

  const [internalOpen, setInternalOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [createdPledge, setCreatedPledge] = useState<any>(null);
  const [isFormInitialized, setIsFormInitialized] = useState(false);

  const [categoryPopoverOpen, setCategoryPopoverOpen] = useState(false);
  const [itemSelectionPopoverOpen, setItemSelectionPopoverOpen] = useState(false);
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [campaignPopoverOpen, setCampaignPopoverOpen] = useState(false);

  // State for category items
  const [categoryItems, setCategoryItems] = useState<CategoryItem[]>([]);
  const [loadingCategoryItems, setLoadingCategoryItems] = useState(false);

  const donationCategory = categories.find(
    (cat) => cat.name.toLowerCase() === "donation"
  );
  const defaultCategoryId = donationCategory?.id || null;

  const [selectedCategoryId, setSelectedCategoryId] = useState<number | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([]);

  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange || setInternalOpen;

  const isEditMode = mode === "edit";

  // Tags query - only fetch tags that should show on pledges
  const { data: tagsData, isLoading: isLoadingTags } = useTagsQuery({
    showOnPledge: true,
    isActive: true,
  });
  const availableTags: Tag[] = tagsData?.tags || [];

  // Campaigns query - fetch campaigns for admin's location
  const { data: campaignsData, isLoading: isLoadingCampaigns } = useCampaigns();
  const availableCampaigns = (campaignsData || []).sort((a, b) => a.name.localeCompare(b.name));

  // Type-and-Enter create for the Category/Campaign dropdowns. We track the
  // combobox search text so "No X found" can offer a "+ Create '<typed>'".
  const [categorySearch, setCategorySearch] = useState("");
  const [campaignSearch, setCampaignSearch] = useState("");
  const { mutateAsync: createCategoryAsync, isPending: isCreatingCategory } = useCreateCategory();
  const { mutateAsync: createCampaignAsync, isPending: isCreatingCampaign } = useCreateCampaign();

  const handleCreateCategory = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const created = await createCategoryAsync({ name: trimmed });
      form.setValue("categoryId", created.id, { shouldValidate: true });
      handleCategoryChange(created.id.toString());
      setCategorySearch("");
      setCategoryPopoverOpen(false);
      toast.success(`Category "${created.name}" created`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to create category");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCategoryAsync]);

  const handleCreateCampaign = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      const created: any = await createCampaignAsync({ name: trimmed });
      const createdName = created?.name ?? trimmed;
      form.setValue("campaignCode", createdName, { shouldValidate: true });
      setCampaignSearch("");
      setCampaignPopoverOpen(false);
      toast.success(`Campaign "${createdName}" created`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to create campaign");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCampaignAsync]);

  // ENHANCED getDefaultValues with better debugging
  const getDefaultValues = useCallback((): PledgeFormData => {
    if (isEditMode && pledgeData) {
      const extractedTagIds = pledgeData.tags?.map((tag: { id: number; name: string }) => tag.id) || [];

      const values = {
        contactId: pledgeData.contactId || contactId,
        categoryId: pledgeData.categoryId || pledgeData.category?.id,
        currency: "USD" as const, // Always USD for USD-only pledges
        exchangeRate: 1, // Always 1 for USD-only
        originalAmount: Math.max(pledgeData.originalAmount || pledgeData.originalAmountUsd || 1, 0.01), // Set to USD amount
        originalAmountUsd: Math.max(pledgeData.originalAmountUsd || pledgeData.originalAmount || 1, 0.01),
        description: pledgeData.description || "",
        pledgeDate: pledgeData.pledgeDate,
        exchangeRateDate: pledgeData.pledgeDate,
        campaignCode: pledgeData.campaignCode || "",
        notes: pledgeData.notes || "",
        tagIds: extractedTagIds,
      };

      return values;
    }

    const defaultValues = {
      contactId,
      categoryId: defaultCategoryId || undefined,
      currency: "USD" as const,
      exchangeRate: 1,
      originalAmount: 0,
      originalAmountUsd: 0,
      description: "",
      pledgeDate: new Date().toISOString().split("T")[0],
      exchangeRateDate: new Date().toISOString().split("T")[0],
      campaignCode: "",
      notes: "",
      tagIds: [],
    };

    return defaultValues;
  }, [isEditMode, pledgeData, contactId, defaultCategoryId]);

  const form = useForm<PledgeFormData>({
    resolver: zodResolver(pledgeSchema),
    mode: "onChange",
  });

  const watchedCurrency = form.watch("currency");
  const watchedOriginalAmount = form.watch("originalAmount");
  const watchedExchangeRateDate = form.watch("exchangeRateDate");
  const watchedExchangeRate = form.watch("exchangeRate");
  const watchedCategoryId = form.watch("categoryId");
  const watchedTagIds = form.watch("tagIds");

  // ENHANCED Selected tags objects with better fallback logic
  const selectedTags = (() => {
    // First try to get tags from available tags (normal flow)
    const tagsFromAvailable = availableTags.filter((tag: Tag) =>
      (watchedTagIds?.includes(tag.id) || selectedTagIds.includes(tag.id))
    );

    // If no tags found in available tags but we have pledge data tags, use those
    if (tagsFromAvailable.length === 0 && isEditMode && pledgeData?.tags) {
      const tagsFromPledge = pledgeData.tags.filter((pledgeTag: any) =>
        (watchedTagIds?.includes(pledgeTag.id) || selectedTagIds.includes(pledgeTag.id))
      );
      return tagsFromPledge;
    }

    return tagsFromAvailable;
  })();

  const { data: exchangeRatesData, isLoading: isLoadingRates, error: ratesError } =
    useExchangeRates(watchedExchangeRateDate);

  const createPledgeMutation = useCreatePledgeMutation();
  const createPledgeAndPayMutation = useCreatePledgeAndPayMutation();
  const updatePledgeMutation = useUpdatePledgeMutation();

  // Function to fetch category items from API
  const fetchCategoryItems = async (categoryId: number) => {
    if (!categoryId) {
      setCategoryItems([]);
      return;
    }

    setLoadingCategoryItems(true);
    try {
      const items = await getCategoryItems(categoryId);
      setCategoryItems(items || []);
    } catch (error) {
      console.error('Error fetching category items:', error);
      setCategoryItems([]);
      toast.error('Failed to load category items');
    } finally {
      setLoadingCategoryItems(false);
    }
  };

  // Simplified initialization
  useEffect(() => {
    if (open) {
      if (isEditMode && pledgeData) {
        const values = getDefaultValues();
        form.reset(values);
        const categoryId = pledgeData.categoryId || pledgeData.category?.id;
        setSelectedCategoryId(categoryId || null);
        setSelectedTagIds(pledgeData.tags?.map((tag: any) => tag.id) || []);
        if (categoryId) {
          fetchCategoryItems(categoryId);
        }
        setIsFormInitialized(true);
      } else {
        const values = getDefaultValues();
        form.reset(values);
        setSelectedCategoryId(defaultCategoryId);
        setSelectedTagIds([]);
        if (defaultCategoryId) {
          fetchCategoryItems(defaultCategoryId);
        }
        setIsFormInitialized(true);
      }
    } else {
      setIsFormInitialized(false);
      if (!isEditMode) {
        setCategoryItems([]);
        setSelectedCategoryId(defaultCategoryId);
        setSelectedTagIds([]);
      }
    }
  }, [open, isEditMode, pledgeData, defaultCategoryId]);

  // Watch for category changes and fetch items
  useEffect(() => {
    if (watchedCategoryId && watchedCategoryId !== selectedCategoryId) {
      setSelectedCategoryId(watchedCategoryId);
      fetchCategoryItems(watchedCategoryId);
    }
  }, [watchedCategoryId, selectedCategoryId]);

  // Sync selectedTagIds with watchedTagIds
  useEffect(() => {
    if (watchedTagIds && Array.isArray(watchedTagIds)) {
      setSelectedTagIds(watchedTagIds);
    }
  }, [watchedTagIds]);

  // Contact ID validation
  useEffect(() => {
    if (!contactId || contactId <= 0) {
      console.error("Invalid contactId prop:", contactId);
      toast.error("Contact ID is missing or invalid");
      return;
    }
  }, [contactId]);

  // Handle exchange rate updates in edit mode
  useEffect(() => {
    if (isEditMode && pledgeData && open && exchangeRatesData?.data?.rates && isFormInitialized) {
      setTimeout(() => {
        const currentCurrency = form.getValues("currency");
        const currentOriginalAmount = form.getValues("originalAmount");

        // If we have exchange rate data and currency is not USD, update the rate
        if (currentCurrency !== "USD") {
          const latestRate = parseFloat(exchangeRatesData.data.rates[currentCurrency]) || 1;
          form.setValue("exchangeRate", latestRate, { shouldValidate: true });

          // Recalculate USD amount with the updated rate
          if (currentOriginalAmount) {
            const recalculatedUsdAmount = currentOriginalAmount / latestRate;
            form.setValue("originalAmountUsd", recalculatedUsdAmount, { shouldValidate: true });
          }
        } else if (currentCurrency === "USD") {
          // For USD, exchange rate should be 1
          form.setValue("exchangeRate", 1, { shouldValidate: true });
          form.setValue("originalAmountUsd", currentOriginalAmount || 0, { shouldValidate: true });
        }

        form.trigger();
      }, 100);
    }
  }, [isEditMode, pledgeData, open, exchangeRatesData, form, isFormInitialized]);

  useEffect(() => {
    if (
      watchedCurrency &&
      watchedExchangeRateDate &&
      exchangeRatesData?.data?.rates &&
      (!isEditMode || form.formState.isDirty)
    ) {
      const rate = parseFloat(exchangeRatesData.data.rates[watchedCurrency]) || 1;
      form.setValue("exchangeRate", rate, { shouldValidate: true });
    }
  }, [watchedCurrency, watchedExchangeRateDate, exchangeRatesData, form, isEditMode]);

  useEffect(() => {
    if (watchedOriginalAmount && watchedExchangeRate) {
      const usdAmount = watchedOriginalAmount / watchedExchangeRate;
      const currentUsdAmount = form.getValues("originalAmountUsd");
      if (Math.abs(currentUsdAmount - usdAmount) > 0.001) {
        form.setValue("originalAmountUsd", usdAmount, {
          shouldValidate: true,
        });
      }
    }
  }, [watchedOriginalAmount, watchedExchangeRate, form]);

  const handleCategoryChange = async (categoryId: string) => {
    const id = parseInt(categoryId);
    form.setValue("categoryId", id, { shouldValidate: true });
    setSelectedCategoryId(id);
    setCategoryPopoverOpen(false);

    // Clear description when changing categories (except in edit mode)
    if (!isEditMode) {
      form.setValue("description", "", { shouldValidate: true });
    }

    // Fetch items for the new category
    await fetchCategoryItems(id);
  };

  const handleItemSelect = (item: CategoryItem) => {
    form.setValue("description", item.name, { shouldValidate: true });
    setItemSelectionPopoverOpen(false);
  };

  // ENHANCED Tag handling functions
  const handleTagToggle = (tagId: number) => {
    const currentTagIds = form.getValues("tagIds") || [];
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id: number) => id !== tagId)
      : [...currentTagIds, tagId];

    form.setValue("tagIds", newTagIds, { shouldValidate: true });
    setSelectedTagIds(newTagIds);
  };

  const handleTagRemove = (tagId: number) => {
    const currentTagIds = form.getValues("tagIds") || [];
    const newTagIds = currentTagIds.filter((id: number) => id !== tagId);

    form.setValue("tagIds", newTagIds, { shouldValidate: true });
    setSelectedTagIds(newTagIds);
  };

  // Campaign field is now shown for all categories

  const onSubmit = async (data: PledgeFormData, shouldOpenPayment = false) => {
    try {
      const isValid = await form.trigger();
      if (!isValid) {
        return;
      }

      if (isEditMode && !pledgeData?.id) {
        toast.error("Pledges ID is missing - cannot update");
        return;
      }

      // Remove rounding, use raw values
      const submissionData = {
        contactId: data.contactId,
        categoryId: data.categoryId,
        pledgeDate: data.pledgeDate,
        description: data.description || "",
        originalAmount: data.originalAmount,
        currency: data.currency,
        originalAmountUsd: data.originalAmountUsd,
        exchangeRate: data.exchangeRate,
        campaignCode: data.campaignCode || undefined,
        notes: data.notes,
        tagIds: data.tagIds || [],
      };

      if (isEditMode) {
        const updateData = {
          id: pledgeData!.id!,
          ...submissionData,
        };

        const result = await updatePledgeMutation.mutateAsync(updateData);
        toast.success("Pledges updated successfully!");
        setOpen(false);
        if (onPledgeUpdated) onPledgeUpdated(pledgeData!.id!);
      } else {
        if (shouldOpenPayment) {
          const result = await createPledgeAndPayMutation.mutateAsync({
            ...submissionData,
            shouldRedirectToPay: true,
          });
          toast.success("Pledges created successfully!");
          resetForm();
          setOpen(false);
          setCreatedPledge(result.pledge);
          setPaymentDialogOpen(true);
        } else {
          const result = await createPledgeMutation.mutateAsync(submissionData);
          toast.success("Pledges created successfully!");
          resetForm();
          setOpen(false);
          if (onPledgeCreated) onPledgeCreated(result.pledge.id);
        }
      }
    } catch (error) {
      const action = isEditMode ? "update" : "create";
      toast.error(error instanceof Error ? error.message : `Failed to ${action} Pledges`);
    }
  };

  const resetForm = () => {
    const defaultValues = getDefaultValues();
    form.reset(defaultValues);
    setSelectedCategoryId(defaultCategoryId);
    setSelectedTagIds([]);
    setCategoryItems([]);
    setIsFormInitialized(false);
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen && !isEditMode) {
      resetForm();
    }
  };

  const handleAmountChange = (field: any, value: string) => {
    const numValue = parseFloat(value) || 0;
    field.onChange(numValue);
  };

  const handleAmountBlur = (field: any, value: number) => {
    field.onChange(value);
  };

  const isSubmitting =
    createPledgeMutation.isPending ||
    createPledgeAndPayMutation.isPending ||
    updatePledgeMutation.isPending;

  const selectedCategory = selectedCategoryId ?
    categories.find(cat => cat.id === selectedCategoryId) : null;

  const defaultTrigger = isEditMode ? (
    <Button size="sm" variant="outline" aria-label="Edit Pledge">
      <Edit className="mr-2 h-4 w-4" />
      Edit
    </Button>
  ) : (
    <Button size="sm" className="border-dashed text-white" aria-label="Create Record">
      <PlusCircle className="mr-2 h-4 w-4" />
      Create Record
    </Button>
  );

  const shouldRenderTrigger = controlledOpen === undefined;

  // Get contact name for dialog description
  const getContactDisplayName = () => {
    if (contactName) return contactName;

    // If we have pledge data with contact information, extract the name
    if (isEditMode && rawPledgeData?.contact?.fullName) {
      return rawPledgeData.contact.fullName;
    }

    if (isEditMode && rawPledgeData?.contact?.firstName && rawPledgeData?.contact?.lastName) {
      return `${rawPledgeData.contact.firstName} ${rawPledgeData.contact.lastName}`;
    }

    return `contact ID ${contactId}`;
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        {shouldRenderTrigger && (
          <DialogTrigger asChild>{trigger || defaultTrigger}</DialogTrigger>
        )}
        <DialogContent className="sm:max-w-[640px] max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isEditMode ? "Edit donation" : "Record a donation"}</DialogTitle>
            <DialogDescription>
              {isEditMode
                ? `Update this donation for ${getContactDisplayName()}.`
                : `Log a pledge or gift for ${getContactDisplayName()}.`}
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((data) => onSubmit(data, false))}
              className="space-y-4"
              noValidate
            >
              {/* Details Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Details</CardTitle>
                  <CardDescription>Category, campaign, and description</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                  {/* Category */}
                  <FormField
                    control={form.control}
                    name="categoryId"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Category</FormLabel>
                        <Popover
                          open={categoryPopoverOpen}
                          onOpenChange={setCategoryPopoverOpen}
                        >
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  "w-full justify-between",
                                  !field.value && "text-muted-foreground",
                                  form.formState.errors.categoryId && "border-red-500"
                                )}
                                aria-haspopup="listbox"
                                aria-expanded={categoryPopoverOpen}
                              >
                                {field.value
                                  ? categories.find(
                                    (category) => category.id === field.value
                                  )?.name
                                  : "Select category"}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-full p-0">
                            <Command>
                              <CommandInput
                                placeholder="Search or create category..."
                                className="h-9"
                                value={categorySearch}
                                onValueChange={setCategorySearch}
                                onKeyDown={(e) => {
                                  const q = categorySearch.trim().toLowerCase();
                                  const noMatch = q.length > 0 && !categories.some((c) => c.name.toLowerCase().includes(q));
                                  if (e.key === "Enter" && noMatch) {
                                    e.preventDefault();
                                    void handleCreateCategory(categorySearch);
                                  }
                                }}
                              />
                              <CommandList>
                                <CommandEmpty>
                                  {categorySearch.trim() ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleCreateCategory(categorySearch)}
                                      disabled={isCreatingCategory}
                                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60"
                                    >
                                      <PlusCircle className="h-4 w-4" /> Create &quot;{categorySearch.trim()}&quot;
                                    </button>
                                  ) : (
                                    "No category found."
                                  )}
                                </CommandEmpty>
                                <CommandGroup>
                                  {categories.map((category) => (
                                    <CommandItem
                                      key={category.id}
                                      value={category.name}
                                      onSelect={() => {
                                        form.setValue("categoryId", category.id, {
                                          shouldValidate: true,
                                        });
                                        handleCategoryChange(category.id.toString());
                                      }}
                                    >
                                      {category.name}
                                      <Check
                                        className={cn(
                                          "ml-auto h-4 w-4",
                                          category.id === field.value
                                            ? "opacity-100"
                                            : "opacity-0"
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

                  {/* Campaign Code */}
                  <FormField
                    control={form.control}
                    name="campaignCode"
                    render={({ field }) => {
                      // Get current campaignCode from field value
                      const currentCampaignCode = field.value;

                      // Check if current campaign exists in available campaigns
                      const campaignExists = currentCampaignCode &&
                        availableCampaigns.some(campaign => campaign.name === currentCampaignCode);

                      // In edit mode, if campaign doesn't exist in list, add it as an option
                      const shouldShowCurrentCampaign = isEditMode &&
                        currentCampaignCode &&
                        !campaignExists &&
                        currentCampaignCode !== "";

                      return (
                        <FormItem className="flex flex-col">
                          <FormLabel>Campaign</FormLabel>
                          <Popover
                            open={campaignPopoverOpen}
                            onOpenChange={setCampaignPopoverOpen}
                          >
                            <PopoverTrigger asChild>
                              <FormControl>
                                <Button
                                  variant="outline"
                                  role="combobox"
                                  className={cn(
                                    "w-full justify-between",
                                    !field.value && "text-muted-foreground",
                                    form.formState.errors.campaignCode && "border-red-500"
                                  )}
                                  disabled={isLoadingCampaigns}
                                  aria-haspopup="listbox"
                                  aria-expanded={campaignPopoverOpen}
                                >
                                  {field.value
                                    ? availableCampaigns.find(
                                        (campaign) => campaign.name === field.value
                                      )?.name || field.value
                                    : isLoadingCampaigns
                                      ? "Loading campaigns..."
                                      : "Select campaign (optional)"}
                                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                              </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-full p-0">
                              <Command>
                                <CommandInput
                                  placeholder="Search or create campaign..."
                                  className="h-9"
                                  value={campaignSearch}
                                  onValueChange={setCampaignSearch}
                                  onKeyDown={(e) => {
                                    const q = campaignSearch.trim().toLowerCase();
                                    const noMatch = q.length > 0 && !availableCampaigns.some((c) => c.name.toLowerCase().includes(q));
                                    if (e.key === "Enter" && noMatch) {
                                      e.preventDefault();
                                      void handleCreateCampaign(campaignSearch);
                                    }
                                  }}
                                />
                                <CommandList>
                                  <CommandEmpty>
                                    {campaignSearch.trim() ? (
                                      <button
                                        type="button"
                                        onClick={() => void handleCreateCampaign(campaignSearch)}
                                        disabled={isCreatingCampaign}
                                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-60"
                                      >
                                        <PlusCircle className="h-4 w-4" /> Create &quot;{campaignSearch.trim()}&quot;
                                      </button>
                                    ) : (
                                      "No campaigns found."
                                    )}
                                  </CommandEmpty>
                                  <CommandGroup>
                                    {/* None option */}
                                    <CommandItem
                                      value="none"
                                      onSelect={() => {
                                        field.onChange("");
                                        form.trigger("campaignCode");
                                        setCampaignPopoverOpen(false);
                                      }}
                                    >
                                      None
                                      <Check
                                        className={cn(
                                          "ml-auto h-4 w-4",
                                          !field.value ? "opacity-100" : "opacity-0"
                                        )}
                                      />
                                    </CommandItem>

                                    {/* Show current campaign first if it doesn't exist in available list */}
                                    {shouldShowCurrentCampaign && (
                                      <CommandItem
                                        value={currentCampaignCode}
                                        onSelect={() => {
                                          field.onChange(currentCampaignCode);
                                          form.trigger("campaignCode");
                                          setCampaignPopoverOpen(false);
                                        }}
                                        className="text-amber-600"
                                      >
                                        {currentCampaignCode} (not in current campaigns)
                                        <Check
                                          className={cn(
                                            "ml-auto h-4 w-4",
                                            field.value === currentCampaignCode
                                              ? "opacity-100"
                                              : "opacity-0"
                                          )}
                                        />
                                      </CommandItem>
                                    )}

                                    {/* Show all available campaigns */}
                                    {availableCampaigns.map((campaign) => (
                                      <CommandItem
                                        key={campaign.id}
                                        value={campaign.name}
                                        onSelect={() => {
                                          field.onChange(campaign.name);
                                          form.trigger("campaignCode");
                                          setCampaignPopoverOpen(false);
                                        }}
                                      >
                                        {campaign.name}
                                        <Check
                                          className={cn(
                                            "ml-auto h-4 w-4",
                                            campaign.name === field.value
                                              ? "opacity-100"
                                              : "opacity-0"
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
                      );
                    }}
                  />
                  </div>

                  {/* Description */}
                  <FormField
                    control={form.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Description</FormLabel>
                        <Popover
                          open={itemSelectionPopoverOpen}
                          onOpenChange={setItemSelectionPopoverOpen}
                        >
                          <PopoverTrigger asChild>
                            <FormControl>
                              <Button
                                variant="outline"
                                role="combobox"
                                className={cn(
                                  "w-full justify-between",
                                  !field.value && "text-muted-foreground",
                                  form.formState.errors.description && "border-red-500"
                                )}
                                disabled={loadingCategoryItems || categoryItems.length === 0}
                              >
                                {field.value ||
                                  (loadingCategoryItems
                                    ? "Loading items..."
                                    : categoryItems.length === 0
                                      ? "No items available"
                                      : `Select item from ${selectedCategory?.name}`)}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                              </Button>
                            </FormControl>
                          </PopoverTrigger>
                          <PopoverContent className="w-full p-0">
                            <Command>
                              <CommandInput
                                placeholder={`Search ${selectedCategory?.name} items...`}
                                className="h-9"
                              />
                              <CommandList className="max-h-[200px]">
                                <CommandEmpty>No items found.</CommandEmpty>
                                <CommandGroup>
                                  {categoryItems.map((item, index) => (
                                    <CommandItem
                                      key={index}
                                      value={item.name}
                                      onSelect={() => {
                                        handleItemSelect(item);
                                      }}
                                    >
                                      {item.name}
                                      <Check
                                        className={cn(
                                          "ml-auto h-4 w-4",
                                          item.name === field.value
                                            ? "opacity-100"
                                            : "opacity-0"
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

                  {/* Tags Field - Enhanced with better debugging */}
                  <FormField
                    control={form.control}
                    name="tagIds"
                    render={({ field }) => (
                      <FormItem className="flex flex-col">
                        <FormLabel>Tags</FormLabel>

                        {/* Selected Tags Display */}
                        {selectedTags.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {selectedTags.map((tag: any) => (
                              <Badge key={tag.id} variant="secondary" className="px-2 py-1">
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
                                {isLoadingTags
                                  ? "Loading tags..."
                                  : availableTags.length === 0
                                    ? "No tags available"
                                    : `Add tags (${selectedTags.length} selected)`
                                }
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
                                {/* Show all available tags AND pledge tags for debugging */}
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
                                  <>
                                    <CommandEmpty>No tags match your search.</CommandEmpty>
                                    <CommandGroup className="p-2">
                                      {availableTags.map((tag: Tag) => {
                                        const isSelected = selectedTagIds.includes(tag.id);
                                        return (
                                          <CommandItem
                                            key={tag.id}
                                            value={tag.name}
                                            keywords={[tag.name, tag.description || ""]}
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
                                              <Check
                                                className={cn(
                                                  "h-4 w-4 flex-shrink-0",
                                                  isSelected ? "opacity-100" : "opacity-0"
                                                )}
                                              />
                                            </div>
                                          </CommandItem>
                                        );
                                      })}
                                    </CommandGroup>
                                  </>
                                )}
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  {/* Amount + Date */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="originalAmount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount (USD) *</FormLabel>
                          <FormControl>
                            <div className="relative">
                              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                              <Input
                                type="number"
                                step="0.01"
                                {...field}
                                onChange={(e) => {
                                  handleAmountChange(field, e.target.value);
                                }}
                                onBlur={(e) => {
                                  handleAmountBlur(field, parseFloat(e.target.value) || 0);
                                }}
                                className={cn(
                                  "pl-7 text-base font-medium",
                                  form.formState.errors.originalAmount && "border-red-500"
                                )}
                              />
                            </div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="pledgeDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Date *</FormLabel>
                          <FormControl>
                            <DateInput
                              value={field.value}
                              onChange={field.onChange}
                              placeholder="MM/DD/YYYY"
                              className={cn(
                                form.formState.errors.pledgeDate && "border-red-500"
                              )}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Notes Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Notes</CardTitle>
                  <CardDescription>Optional — anything worth recording</CardDescription>
                </CardHeader>
                <CardContent>
                  <FormField
                    control={form.control}
                    name="notes"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="sr-only">Notes</FormLabel>
                        <FormControl>
                          <Textarea
                            {...field}
                            placeholder="Add a note about this donation…"
                            rows={3}
                            className={cn(
                              form.formState.errors.notes && "border-red-500"
                            )}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </CardContent>
              </Card>

              {/* Action Buttons */}
              <div className="flex flex-wrap justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                {isEditMode ? (
                  <Button type="submit" disabled={isSubmitting || isLoadingRates}>
                    {isSubmitting ? "Saving…" : "Save changes"}
                  </Button>
                ) : (
                  <>
                    <Button type="submit" variant="outline" disabled={isSubmitting || isLoadingRates}>
                      {isSubmitting ? "Saving…" : "Save donation"}
                    </Button>
                    <Button
                      type="button"
                      onClick={form.handleSubmit((data) => onSubmit(data, true))}
                      disabled={isSubmitting || isLoadingRates}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      {isSubmitting ? "Saving…" : "Save & add payment"}
                    </Button>
                  </>
                )}
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {createdPledge && (
        <PaymentDialog
          pledgeId={createdPledge.id}
          pledgeAmount={parseFloat(createdPledge.originalAmount)}
          pledgeCurrency={createdPledge.currency}
          pledgeDescription={createdPledge.description}
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          onPaymentCreated={() => {
            setCreatedPledge(null);
            if (onPledgeCreated) onPledgeCreated(createdPledge.id);
          }}
        />
      )}
    </>
  );
}
