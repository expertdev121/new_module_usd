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
import { Loader2 } from "lucide-react";
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
  const [customNote, setCustomNote] = useState("Your generosity throughout the year helped over 100 children in need. Thank you for making a difference in our community!");
  const [signatureName, setSignatureName] = useState("Executive Director");

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
          customNote,
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
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send Year End Donation Letters</DialogTitle>
          <DialogDescription>
            Select contacts and customize the letter details to send via webhook.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Year Selection */}
          <div className="grid gap-2">
            <Label htmlFor="year">Year *</Label>
            <Input
              id="year"
              type="number"
              value={selectedYear}
              onChange={(e) => handleYearChange(e.target.value)}
              placeholder="Enter year (e.g., 2024)"
              className={yearError ? "border-red-500" : ""}
            />
            {yearError && <p className="text-sm text-red-500">{yearError}</p>}
          </div>

          {/* Contact Selection */}
          <div className="grid gap-2">
            <Label>Select Contacts *</Label>
            {isLoadingContacts ? (
              <div className="flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading contacts...</span>
              </div>
            ) : (
              <>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleSelectAll}>
                    Select All
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleDeselectAll}>
                    Deselect All
                  </Button>
                </div>
                <div className="max-h-40 overflow-y-auto border rounded p-2">
                  {contacts.map((contact) => (
                    <div key={contact.id} className="flex items-center space-x-2">
                      <Checkbox
                        id={`contact-${contact.id}`}
                        checked={selectedContacts.includes(contact.id)}
                        onCheckedChange={() => handleContactToggle(contact.id)}
                      />
                      <Label htmlFor={`contact-${contact.id}`}>
                        {contact.displayName || `${contact.firstName} ${contact.lastName}`} - {contact.email}
                      </Label>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Charity Name */}
          <div className="grid gap-2">
            <Label htmlFor="charityName">Charity Name</Label>
            <Input
              id="charityName"
              value={charityName}
              onChange={(e) => setCharityName(e.target.value)}
              placeholder="ABC Charity"
            />
          </div>

          {/* Charity Address */}
          <div className="grid gap-2">
            <Label htmlFor="charityAddress">Charity Address</Label>
            <Input
              id="charityAddress"
              value={charityAddress}
              onChange={(e) => setCharityAddress(e.target.value)}
              placeholder="1234 Main Street, Anytown, USA"
            />
          </div>

          {/* Tax ID */}
          <div className="grid gap-2">
            <Label htmlFor="taxId">Federal Tax ID</Label>
            <Input
              id="taxId"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="12-3456789"
            />
          </div>

          {/* Custom Note */}
          <div className="grid gap-2">
            <Label htmlFor="customNote">Impact Statement</Label>
            <Textarea
              id="customNote"
              value={customNote}
              onChange={(e) => setCustomNote(e.target.value)}
              placeholder="Your generosity throughout the year helped..."
              rows={3}
            />
          </div>

          {/* Signature Name */}
          <div className="grid gap-2">
            <Label htmlFor="signatureName">Signature Title</Label>
            <Input
              id="signatureName"
              value={signatureName}
              onChange={(e) => setSignatureName(e.target.value)}
              placeholder="Executive Director"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!selectedYear || selectedContacts.length === 0 || isGenerating || !!yearError}
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              "Generate Letter"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}