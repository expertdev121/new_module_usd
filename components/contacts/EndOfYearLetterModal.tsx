"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Users, Building2, Hash, FileText, PenLine } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Contact {
  id: number;
  firstName: string;
  lastName: string;
  displayName: string | null;
  email: string;
}

interface EndOfYearLetterModalProps {
  isOpen: boolean;
  onClose: () => void;
  locationId: string | null;
}

export default function EndOfYearLetterModal({
  isOpen,
  onClose,
  locationId,
}: EndOfYearLetterModalProps) {
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedContacts, setSelectedContacts] = useState<number[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);
  const [yearError, setYearError] = useState<string>("");

  // Customization fields
  const [charityName, setCharityName] = useState("ABC Charity");
  const [charityAddress, setCharityAddress] = useState("1234 Main Street, Anytown, USA");
  const [taxId, setTaxId] = useState("12-3456789");
  const [logoLink, setLogoLink] = useState("");
  const [signatureName, setSignatureName] = useState("Executive Director");
  const [searchTerm, setSearchTerm] = useState(""); 

  const filteredContacts = contacts.filter(contact =>
    contact.displayName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    `${contact.firstName} ${contact.lastName}`.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const { toast } = useToast();

  // Fetch contacts when year is selected
  useEffect(() => {
    if (selectedYear && !yearError) {
      fetchContacts();
    } else {
      setContacts([]);
      setSelectedContacts([]);
    }
  }, [selectedYear, locationId, yearError]);

  const handleGenerate = async () => {
    if (!selectedYear) {
      toast({
        title: "Error",
        description: "Please select a year",
        variant: "destructive",
      });
      return;
    }

    if (selectedContacts.length === 0) {
      toast({
        title: "Error",
        description: "Please select at least one contact",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch("/api/contacts/send-year-end-letters", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contactIds: selectedContacts,
          year: selectedYear,
          charityName,
          charityAddress,
          taxId,
          logoLink,
          signatureName,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        toast({
          title: "Success",
          description: `Sent ${result.message}`,
        });
        onClose();
      } else {
        const errorData = await response.json();
        toast({
          title: "Error",
          description: errorData.error || "Failed to send letters",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error sending letters:", error);
      toast({
        title: "Error",
        description: "Failed to send letters",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const fetchContacts = async () => {
    setIsLoadingContacts(true);
    try {
      const params = new URLSearchParams();
      params.append("year", selectedYear);
      if (locationId) {
        params.append("locationId", locationId);
      }
      const url = `/api/contacts/emails?${params.toString()}`;

      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setContacts(data.contacts);
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch contacts",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error fetching contacts:", error);
      toast({
        title: "Error",
        description: "Failed to fetch contacts",
        variant: "destructive",
      });
    } finally {
      setIsLoadingContacts(false);
    }
  };

  const handleContactToggle = (contactId: number) => {
    setSelectedContacts(prev =>
      prev.includes(contactId)
        ? prev.filter(id => id !== contactId)
        : [...prev, contactId]
    );
  };

  const handleSelectAll = () => {
    setSelectedContacts(contacts.map(c => c.id));
  };

  const handleDeselectAll = () => {
    setSelectedContacts([]);
  };

  const validateYear = (year: string) => {
    const yearNum = parseInt(year);
    const currentYear = new Date().getFullYear();
    if (isNaN(yearNum) || yearNum < 2000 || yearNum > currentYear + 1) {
      setYearError("Please enter a valid year (e.g., 2024)");
      return false;
    }
    setYearError("");
    return true;
  };

  const handleYearChange = (value: string) => {
    setSelectedYear(value);
    if (value) {
      validateYear(value);
    } else {
      setYearError("");
    }
  };

  const handleClose = () => {
    setSelectedYear("");
    setContacts([]);
    setSelectedContacts([]);
    setYearError("");
    setLogoLink("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader className="space-y-3 pb-4 border-b">
          <DialogTitle className="text-2xl">Send Year End Donation Letters</DialogTitle>
          <DialogDescription className="text-base">
            Select contacts and customize the letter details to send via webhook.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-1">
          <div className="space-y-4 py-6">
            {/* Year Selection Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                  <Hash className="h-4 w-4" />
                </div>
                <div>
                  <Label htmlFor="year" className="text-base font-semibold">
                    Tax Year <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-sm text-muted-foreground">Select the year for donation reporting</p>
                </div>
              </div>
              <Input
                id="year"
                type="number"
                value={selectedYear}
                onChange={(e) => handleYearChange(e.target.value)}
                placeholder="Enter year (e.g., 2024)"
                className={`h-11 ${yearError ? "border-destructive" : ""}`}
              />
              {yearError && (
                <p className="text-sm text-destructive flex items-center gap-1">
                  {yearError}
                </p>
              )}
            </div>

            {/* Contact Selection Section */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                  <Users className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <Label className="text-base font-semibold">
                    Recipients <span className="text-destructive">*</span>
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {selectedContacts.length > 0 
                      ? `${selectedContacts.length} contact${selectedContacts.length !== 1 ? 's' : ''} selected`
                      : 'Select contacts to receive letters'}
                  </p>
                </div>
              </div>
              <Input
                placeholder="Search contacts..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 mt-2"
              />
              
              {isLoadingContacts ? (
                <div className="flex items-center justify-center space-x-2 py-8 border rounded-lg bg-muted/30">
                  <Loader2 className="h-5 w-5 animate-spin" />
                  <span className="text-muted-foreground">Loading contacts...</span>
                </div>
              ) : contacts.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleSelectAll}
                      className="h-9"
                    >
                      Select All ({contacts.length})
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleDeselectAll}
                      className="h-9"
                    >
                      Deselect All
                    </Button>
                  </div>
                  <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                    {filteredContacts.map((contact) => (
                      <div 
                        key={contact.id} 
                        className="flex items-center space-x-3 p-3 hover:bg-muted/50 transition-colors"
                      >
                        <Checkbox
                          id={`contact-${contact.id}`}
                          checked={selectedContacts.includes(contact.id)}
                          onCheckedChange={() => handleContactToggle(contact.id)}
                        />
                        <Label 
                          htmlFor={`contact-${contact.id}`}
                          className="flex-1 cursor-pointer font-normal"
                        >
                          <div className="font-medium">
                            {contact.displayName || `${contact.firstName} ${contact.lastName}`}
                          </div>
                          <div className="text-sm text-muted-foreground">{contact.email}</div>
                        </Label>
                      </div>
                    ))}
                  </div>
                </div>
              ) : selectedYear && !yearError ? (
                <div className="text-center py-8 border rounded-lg bg-muted/30">
                  <Users className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-muted-foreground">No contacts found for {selectedYear}</p>
                </div>
              ) : null}
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Letter Details</span>
              </div>
            </div>

            {/* Organization Information */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                  <Building2 className="h-4 w-4" />
                </div>
                <Label className="text-base font-semibold">Organization Information</Label>
              </div>

              <div className="grid gap-4 pl-10">
                <div className="space-y-2">
                  <Label htmlFor="charityName" className="text-sm font-medium">
                    Charity Name
                  </Label>
                  <Input
                    id="charityName"
                    value={charityName}
                    onChange={(e) => setCharityName(e.target.value)}
                    placeholder="ABC Charity"
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="charityAddress" className="text-sm font-medium">
                    Charity Address
                  </Label>
                  <Input
                    id="charityAddress"
                    value={charityAddress}
                    onChange={(e) => setCharityAddress(e.target.value)}
                    placeholder="1234 Main Street, Anytown, USA"
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="taxId" className="text-sm font-medium">
                    Federal Tax ID
                  </Label>
                  <Input
                    id="taxId"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    placeholder="12-3456789"
                    className="h-10"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="logoLink" className="text-sm font-medium">
                    Logo Link
                  </Label>
                  <Input
                    id="logoLink"
                    value={logoLink}
                    onChange={(e) => setLogoLink(e.target.value)}
                    placeholder="https://example.com/logo.png"
                    className="h-10"
                  />
                  <p className="text-xs text-muted-foreground">
                    URL to the organization's logo image (PNG, JPG, etc.)
                  </p>
                </div>
              </div>
            </div>

            {/* Letter Content */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
                  <FileText className="h-4 w-4" />
                </div>
                <Label className="text-base font-semibold">Letter Content</Label>
              </div>

              <div className="grid gap-4 pl-10">


                <div className="space-y-2">
                  <Label htmlFor="signatureName" className="text-sm font-medium">
                    Signature Title
                  </Label>
                  <Input
                    id="signatureName"
                    value={signatureName}
                    onChange={(e) => setSignatureName(e.target.value)}
                    placeholder="Executive Director"
                    className="h-10"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="pt-4 border-t gap-2">
          <Button variant="outline" onClick={handleClose} className="h-10">
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!selectedYear || selectedContacts.length === 0 || isGenerating || !!yearError}
            className="h-10 min-w-[140px]"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <PenLine className="mr-2 h-4 w-4" />
                Generate Letters
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}