"use client";

import React, { useState, useMemo, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription } from "@/components/ui/card";
import { Users, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  useCreateRelationshipMutation,
  useContactSearchQuery,
  useContactDetailsQuery,
} from "@/lib/query/relationships/useRelationshipQuery";

// Define Contact interface for strong typing
interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  email?: string | null;
}

// -- Updated Relationship Types with exact DB enum string values
const relationshipTypes = [
  { value: "His Sister", label: "His Sister" },
  { value: "Her Sister", label: "Her Sister" },
  { value: "Her Brother", label: "Her Brother" },
  { value: "His Brother", label: "His Brother" },
  { value: "His Aunt", label: "His Aunt" },
  { value: "Her Aunt", label: "Her Aunt" },
  { value: "His Uncle", label: "His Uncle" },
  { value: "Her Uncle", label: "Her Uncle" },
  { value: "Her Parents", label: "Her Parents" },
  { value: "Her Mother", label: "Her Mother" },
  { value: "His Mother", label: "His Mother" },
  { value: "His Father", label: "His Father" },
  { value: "His Parents", label: "His Parents" },
  { value: "Her Nephew", label: "Her Nephew" },
  { value: "His Nephew", label: "His Nephew" },
  { value: "His Niece", label: "His Niece" },
  { value: "Her Niece", label: "Her Niece" },
  { value: "His Grandparents", label: "His Grandparents" },
  { value: "Her Grandparents", label: "Her Grandparents" },
  { value: "Her Father", label: "Her Father" },
  { value: "Their Daughter", label: "Their Daughter" },
  { value: "Their Son", label: "Their Son" },
  { value: "His Daughter", label: "His Daughter" },
  { value: "His Son", label: "His Son" },
  { value: "Her Daughter", label: "Her Daughter" },
  { value: "Her Son", label: "Her Son" },
  { value: "His Cousin (M)", label: "His Cousin (M)" },
  { value: "Her Grandfather", label: "Her Grandfather" },
  { value: "Her Grandmother", label: "Her Grandmother" },
  { value: "His Grandfather", label: "His Grandfather" },
  { value: "His Grandmother", label: "His Grandmother" },
  { value: "His Wife", label: "His Wife" },
  { value: "Her Former Husband", label: "Her Former Husband" },
  { value: "His Former Wife", label: "His Former Wife" },
  { value: "His Cousin (F)", label: "His Cousin (F)" },
  { value: "Her Cousin (M)", label: "Her Cousin (M)" },
  { value: "Her Cousin (F)", label: "Her Cousin (F)" },
  { value: "Partner", label: "Partner" },
  { value: "Friend", label: "Friend" },
  { value: "Neighbor", label: "Neighbor" },
  { value: "Relative", label: "Relative" },
  { value: "Business", label: "Business" },
  { value: "Chevrusa", label: "Chevrusa" },
  { value: "Congregant", label: "Congregant" },
  { value: "Contact", label: "Contact" },
  { value: "Donor", label: "Donor" },
  { value: "Fiance", label: "Fiance" },
  { value: "Foundation", label: "Foundation" },
  { value: "Fund", label: "Fund" },
  { value: "Her Step Son", label: "Her Step Son" },
  { value: "His Step Mother", label: "His Step Mother" },
  { value: "Owner", label: "Owner" },
  { value: "Rabbi", label: "Rabbi" },
  { value: "Their Granddaughter", label: "Their Granddaughter" },
  { value: "Their Grandson", label: "Their Grandson" },
  { value: "Employee", label: "Employee" },
  { value: "Employer", label: "Employer" },
] as const;

// Extract the union type from the relationship types
type RelationshipType = typeof relationshipTypes[number]["value"];

// Create a tuple type for the enum values
const relationshipValues = relationshipTypes.map((t) => t.value);
const [firstValue, ...restValues] = relationshipValues;

const relationshipSchema = z
  .object({
    contactId: z.coerce.number().positive("Contact ID is required"),
    relatedContactId: z.number().positive("Related contact must be selected"),
    relationshipType: z.enum([firstValue, ...restValues] as [RelationshipType, ...RelationshipType[]], {
      required_error: "Relationship type is required",
    }),
    isActive: z.boolean(),
    notes: z.string().optional(),
  })
  .refine((data) => data.contactId !== data.relatedContactId, {
    message: "Cannot create relationship with the same contact",
    path: ["relatedContactId"],
  });

type RelationshipFormData = z.infer<typeof relationshipSchema>;

// Define the mutation input type based on your database NewRelationship type
interface CreateRelationshipInput {
  contactId: number;
  relatedContactId: number;
  relationshipType: RelationshipType;
  isActive: boolean;
  notes?: string;
}

interface RelationshipDialogProps {
  contactId: number;
  contactName?: string;
  contactEmail?: string;
  triggerButton?: React.ReactNode;
}

export default function RelationshipDialog(props: RelationshipDialogProps) {
  const { contactId, contactName } = props;
  const [open, setOpen] = useState(false);
  const [contactSearch, setContactSearch] = useState("");
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  // Fetch main contact details to display
  const { data: contactData, isLoading: isLoadingContact } = useContactDetailsQuery(contactId);

  // Fetch contacts for search dropdown, enable only if search string >=2 chars
  const { data: searchResults, isLoading: isSearching } = useContactSearchQuery(contactSearch, {
    enabled: contactSearch.length >= 2,
  });

  // Deduplicate search results based on contact ID
  const uniqueSearchResults = useMemo(() => {
    if (!searchResults?.contacts) return [];
    
    const uniqueContacts = new Map<number, Contact>();
    
    searchResults.contacts.forEach((contact: Contact) => {
      if (contact.id !== contactId && !uniqueContacts.has(contact.id)) {
        uniqueContacts.set(contact.id, contact);
      }
    });
    
    return Array.from(uniqueContacts.values()).slice(0, 8); // Limit to 8 results
  }, [searchResults?.contacts, contactId]);

  const effectiveContactName = contactName || contactData?.contact.firstName || "Unknown Contact";
  const createRelationshipMutation = useCreateRelationshipMutation();

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const form = useForm<RelationshipFormData>({
    resolver: zodResolver(relationshipSchema),
    defaultValues: {
      contactId,
      relatedContactId: 0,
      relationshipType: undefined as RelationshipFormData["relationshipType"] | undefined,
      isActive: true,
      notes: "",
    },
  });

  const resetForm = () => {
    form.reset({
      contactId,
      relatedContactId: 0,
      relationshipType: undefined as RelationshipFormData["relationshipType"] | undefined,
      isActive: true,
      notes: "",
    });
    setContactSearch("");
    setSelectedContact(null);
    setShowDropdown(false);
  };

  const onSubmit = async (data: RelationshipFormData) => {
    try {
      const relationshipData: CreateRelationshipInput = {
        contactId: data.contactId,
        relatedContactId: data.relatedContactId,
        relationshipType: data.relationshipType,
        isActive: data.isActive,
        notes: data.notes || undefined,
      };

      await createRelationshipMutation.mutateAsync(relationshipData);
      resetForm();
      setOpen(false);
    } catch (error) {
      console.error("Error creating relationship:", error);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      resetForm();
    }
  };

  const handleContactSelect = (contact: Contact) => {
    form.setValue("relatedContactId", contact.id);
    setSelectedContact(contact);
    setContactSearch(`${contact.firstName} ${contact.lastName}`);
    setShowDropdown(false);
  };

  const handleClearSearch = () => {
    setSelectedContact(null);
    form.setValue("relatedContactId", 0);
    setContactSearch("");
    setShowDropdown(true);
  };

  const selectedRelationshipType = form.watch("relationshipType");
  const selectedRelatedContactId = form.watch("relatedContactId");

  const showSearchResults = contactSearch.length >= 2 && !selectedContact && showDropdown;

  return (
    <>
      {props.triggerButton ? (
        <div onClick={() => setOpen(true)}>{props.triggerButton}</div>
      ) : (
        <Button onClick={() => setOpen(true)} size="sm" variant="outline" className="border-dashed">
          <Users className="w-4 h-4 mr-2" />
          Add Relationship
        </Button>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>Add Relationship</CardTitle>
              <CardDescription>
                {isLoadingContact ? (
                  "Loading contact details..."
                ) : (
                  <>
                    Create a relationship for: <strong>{effectiveContactName}</strong>
                    {contactData?.activeRelationships?.length ? (
                      <div className="mt-2 text-sm text-muted-foreground">
                        {contactData.activeRelationships.length} active relationship
                        {contactData.activeRelationships.length > 1 ? "s" : ""}
                      </div>
                    ) : null}
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                {/* CONTACT SEARCH */}
                <div className="mb-4 relative" ref={searchContainerRef}>
                  <FormLabel>Search Related Contact *</FormLabel>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Type name or email to search contacts..."
                      value={contactSearch}
                      onChange={(e) => {
                        setContactSearch(e.target.value);
                        setShowDropdown(true);
                      }}
                      onFocus={() => setShowDropdown(true)}
                      className="pl-10 pr-10"
                    />
                    {contactSearch && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleClearSearch}
                        className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0 hover:bg-gray-100"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  
                  {/* SEARCH RESULTS DROPDOWN */}
                  {showSearchResults && (
                    <div className="absolute top-full left-0 right-0 z-20 mt-1 bg-white border rounded-md shadow-lg max-h-64 overflow-y-auto">
                      {isSearching ? (
                        <div className="p-3 flex items-center justify-center text-sm text-muted-foreground">
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-2"></div>
                          Searching...
                        </div>
                      ) : uniqueSearchResults.length > 0 ? (
                        <>
                          <div className="p-2 text-xs text-muted-foreground border-b bg-gray-50">
                            {uniqueSearchResults.length} contact{uniqueSearchResults.length !== 1 ? 's' : ''} found
                          </div>
                          {uniqueSearchResults.map((contact: Contact) => (
                            <div
                              key={contact.id}
                              className="w-full text-left p-3 hover:bg-blue-50 border-b last:border-b-0 transition-colors duration-150 cursor-pointer"
                              onMouseDown={() => handleContactSelect(contact)}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-medium text-sm">
                                    {contact.firstName} {contact.lastName}
                                  </div>
                                  {contact.email && (
                                    <div className="text-xs text-muted-foreground mt-1">
                                      {contact.email}
                                    </div>
                                  )}
                                </div>
                                <div className="text-xs text-blue-600">
                                  Select
                                </div>
                              </div>
                            </div>
                          ))}
                        </>
                      ) : contactSearch.length >= 2 ? (
                        <div className="p-3 text-sm text-muted-foreground text-center">
                          <div className="mb-1">No contacts found</div>
                          <div className="text-xs">Try searching with a different term</div>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {/* SELECTED CONTACT CARD */}
                  {selectedContact && (
                    <div className="mt-3 p-3 rounded-lg border-2 border-green-200 bg-green-50 flex justify-between items-center gap-3">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full bg-green-500"></div>
                        <div>
                          <div className="font-medium text-sm">
                            {selectedContact.firstName} {selectedContact.lastName}
                          </div>
                          {selectedContact.email && (
                            <div className="text-xs text-muted-foreground">
                              {selectedContact.email}
                            </div>
                          )}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleClearSearch}
                        className="h-8 w-8 p-0 hover:bg-green-200 text-green-700"
                        title="Remove selected contact"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                  
                  {/* Search hint */}
                  {contactSearch.length > 0 && contactSearch.length < 2 && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Type at least 2 characters to search
                    </div>
                  )}
                </div>

                {/* Relationship Type as Dropdown */}
                <FormField
                  control={form.control}
                  name="relationshipType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Relationship Type *</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select relationship type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent className="max-h-[300px]">
                          {relationshipTypes.map((type) => (
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

                {/* Status */}
                <FormField
                  control={form.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2 my-4">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                      <div>
                        <FormLabel>Active Relationship</FormLabel>
                        <div className="text-xs text-muted-foreground">
                          Whether this relationship is currently active
                        </div>
                      </div>
                    </FormItem>
                  )}
                />

                {/* Notes */}
                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea {...field} placeholder="Additional notes about this relationship" rows={3} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {/* SUMMARY */}
                {selectedContact && selectedRelationshipType && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mt-4">
                    <h4 className="font-medium text-blue-900 mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Relationship Summary
                    </h4>
                    <div className="text-sm text-blue-800 space-y-1">
                      <div>
                        {(() => {
                          // Define relationship categories for proper summary generation
                          const relationshipTypesWhereRelatedIsSubject = new Set([
                            // Child relationships - the related contact IS the child
                            "Their Son",
                            "Their Daughter", 
                            "His Son", 
                            "Her Son",
                            "His Daughter",
                            "Her Daughter",
                            "Her Step Son",
                            
                            // Grandchild relationships - the related contact IS the grandchild
                            "Their Grandson",
                            "Their Granddaughter",
                            
                            // Nephew/Niece relationships - the related contact IS the nephew/niece
                            "His Nephew",
                            "Her Nephew", 
                            "His Niece",
                            "Her Niece",
                            
                            // Spouse relationship - the related contact IS the spouse
                            "His Wife",
                          ]);

                          const relationshipTypesWhereMainIsSubject = new Set([
                            // Sibling relationships - the main contact IS the sibling
                            "His Sister",
                            "Her Sister",
                            "Her Brother", 
                            "His Brother",
                            
                            // Parent relationships - the main contact IS the parent/child
                            "His Mother",
                            "Her Mother", 
                            "His Father",
                            "Her Father",
                            "His Parents",
                            "Her Parents",
                            
                            // Aunt/Uncle relationships - the main contact IS the aunt/uncle
                            "His Aunt",
                            "Her Aunt",
                            "His Uncle",
                            "Her Uncle",
                            
                            // Grandparent relationships - the main contact IS the grandparent
                            "His Grandfather", 
                            "Her Grandfather",
                            "His Grandmother",
                            "Her Grandmother",
                            "His Grandparents",
                            "Her Grandparents",
                            
                            // Cousin relationships - the main contact IS the cousin
                            "His Cousin (M)",
                            "His Cousin (F)",
                            "Her Cousin (M)",
                            "Her Cousin (F)",
                            
                            // Step relationships - the main contact IS the step relative
                            "His Step Mother",
                            
                            // Former spouse relationships - the main contact IS the former spouse
                            "Her Former Husband",
                            "His Former Wife",
                          ]);

                          const mutualRelationshipTypes = new Set([
                            "Partner",
                            "Friend", 
                            "Neighbor",
                            "Relative",
                            "Fiance",
                          ]);

                          const professionalRelationshipTypes = new Set([
                            "Business",
                            "Employee",
                            "Employer",
                            "Owner",
                          ]);

                          const communityRelationshipTypes = new Set([
                            "Chevrusa",
                            "Congregant",
                            "Rabbi",
                            "Donor",
                          ]);

                          const generalRelationshipTypes = new Set([
                            "Contact", 
                            "Foundation",
                            "Fund",
                          ]);

                          // Helper function to clean relationship labels
                          const cleanRelationshipLabel = (label: string) => {
                            return label.toLowerCase().replace(/^(his|her|their)\s+/, '');
                          };

                          if (relationshipTypesWhereRelatedIsSubject.has(selectedRelationshipType)) {
                            // The related contact IS the relationship to the main contact
                            // e.g., "Their Son" means Avi Masri is Larry's son
                            return (
                              <>
                                <strong>
                                  {selectedContact.firstName} {selectedContact.lastName}
                                </strong>{" "}
                                is <strong>{effectiveContactName}</strong>&apos;s{" "}
                                <strong>
                                  {cleanRelationshipLabel(selectedRelationshipType)}
                                </strong>
                              </>
                            );
                          } else if (relationshipTypesWhereMainIsSubject.has(selectedRelationshipType)) {
                            // The main contact IS the relationship to the related contact  
                            // e.g., "His Sister" means Larry is Avi Masri's sister
                            return (
                              <>
                                <strong>{effectiveContactName}</strong> is{" "}
                                <strong>
                                  {selectedContact.firstName} {selectedContact.lastName}
                                </strong>&apos;s{" "}
                                <strong>
                                  {cleanRelationshipLabel(selectedRelationshipType)}
                                </strong>
                              </>
                            );
                          } else if (mutualRelationshipTypes.has(selectedRelationshipType)) {
                            // Mutual relationships - both are the same to each other
                            const relationshipLabel = selectedRelationshipType.toLowerCase();
                            const pluralLabel = relationshipLabel === 'fiance' ? 'fiancés' : 
                                              relationshipLabel === 'relative' ? 'relatives' : 
                                              relationshipLabel + 's';
                            return (
                              <>
                                <strong>{effectiveContactName}</strong> and{" "}
                                <strong>
                                  {selectedContact.firstName} {selectedContact.lastName}
                                </strong>{" "}
                                are <strong>{pluralLabel}</strong>
                              </>
                            );
                          } else if (professionalRelationshipTypes.has(selectedRelationshipType)) {
                            // Professional relationships
                            if (selectedRelationshipType === "Employee") {
                              return (
                                <>
                                  <strong>{effectiveContactName}</strong> is an employee of{" "}
                                  <strong>
                                    {selectedContact.firstName} {selectedContact.lastName}
                                  </strong>
                                </>
                              );
                            } else if (selectedRelationshipType === "Employer") {
                              return (
                                <>
                                  <strong>{effectiveContactName}</strong> is the employer of{" "}
                                  <strong>
                                    {selectedContact.firstName} {selectedContact.lastName}
                                  </strong>
                                </>
                              );
                            } else if (selectedRelationshipType === "Owner") {
                              return (
                                <>
                                  <strong>{effectiveContactName}</strong> is the owner of{" "}
                                  <strong>
                                    {selectedContact.firstName} {selectedContact.lastName}
                                  </strong>
                                </>
                              );
                            } else {
                              return (
                                <>
                                  <strong>{effectiveContactName}</strong> has a business relationship with{" "}
                                  <strong>
                                    {selectedContact.firstName} {selectedContact.lastName}
                                  </strong>
                                </>
                              );
                            }
                          } else if (communityRelationshipTypes.has(selectedRelationshipType)) {
                            // Community/Religious relationships
                            if (selectedRelationshipType === "Rabbi") {
                              return (
                                <>
                                  <strong>{effectiveContactName}</strong> is the rabbi of{" "}
                                  <strong>
                                    {selectedContact.firstName} {selectedContact.lastName}
                                  </strong>
                                </>
                              );
                            } else if (selectedRelationshipType === "Congregant") {
                              return (
                                <>
                                  <strong>{effectiveContactName}</strong> and{" "}
                                  <strong>
                                    {selectedContact.firstName} {selectedContact.lastName}
                                  </strong>{" "}
                                  are congregants together
                                </>
                              );
                            } else if (selectedRelationshipType === "Donor") {
                              return (
                                <>
                                  <strong>{effectiveContactName}</strong> is a donor to{" "}
                                  <strong>
                                    {selectedContact.firstName} {selectedContact.lastName}
                                  </strong>
                                </>
                              );
                            } else if (selectedRelationshipType === "Chevrusa") {
                              return (
                                <>
                                  <strong>{effectiveContactName}</strong> and{" "}
                                  <strong>
                                    {selectedContact.firstName} {selectedContact.lastName}
                                  </strong>{" "}
                                  are study partners (chevrusas)
                                </>
                              );
                            }
                          } else if (generalRelationshipTypes.has(selectedRelationshipType)) {
                            // General relationship types
                            const relationshipLabel = selectedRelationshipType.toLowerCase();
                            return (
                              <>
                                <strong>{effectiveContactName}</strong> is a{" "}
                                <strong>{relationshipLabel}</strong> of{" "}
                                <strong>
                                  {selectedContact.firstName} {selectedContact.lastName}
                                </strong>
                              </>
                            );
                          } else {
                            // Default fallback for any unhandled cases
                            return (
                              <>
                                <strong>{effectiveContactName}</strong> is related to{" "}
                                <strong>
                                  {selectedContact.firstName} {selectedContact.lastName}
                                </strong>{" "}
                                as <strong>{selectedRelationshipType.toLowerCase()}</strong>
                              </>
                            );
                          }
                        })()}
                      </div>
                      <div className="flex items-center gap-2">
                        <span>Status:</span>
                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                          form.watch("isActive") 
                            ? "bg-green-100 text-green-800" 
                            : "bg-gray-100 text-gray-800"
                        }`}>
                          {form.watch("isActive") ? "Active" : "Inactive"}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </Form>
            </CardContent>
            <CardFooter className="flex justify-end space-x-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={createRelationshipMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={form.handleSubmit(onSubmit)}
                disabled={
                  createRelationshipMutation.isPending ||
                  isLoadingContact ||
                  !selectedRelatedContactId ||
                  !selectedRelationshipType
                }
              >
                {createRelationshipMutation.isPending ? "Adding..." : "Add Relationship"}
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </>
  );
}