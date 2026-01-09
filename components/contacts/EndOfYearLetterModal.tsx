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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface EndOfYearLetterModalProps {
  isOpen: boolean;
  onClose: () => void;
  contactId: number;
  contactName: string;
}

export default function EndOfYearLetterModal({
  isOpen,
  onClose,
  contactId,
  contactName,
}: EndOfYearLetterModalProps) {
  const [selectedYear, setSelectedYear] = useState<string>("");
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [isLoadingYears, setIsLoadingYears] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Customization fields
  const [charityName, setCharityName] = useState("ABC Charity");
  const [charityAddress, setCharityAddress] = useState("1234 Main Street, Anytown, USA");
  const [taxId, setTaxId] = useState("12-3456789");
  const [customNote, setCustomNote] = useState("Your generosity throughout the year helped over 100 children in need. Thank you for making a difference in our community!");
  const [signatureName, setSignatureName] = useState("Executive Director");
  
  const { toast } = useToast();

  // Fetch available years when modal opens
  useEffect(() => {
    if (isOpen && contactId) {
      fetchAvailableYears();
    }
  }, [isOpen, contactId]);

  const fetchAvailableYears = async () => {
    setIsLoadingYears(true);
    try {
      const response = await fetch(`/api/contacts/${contactId}/payment-years`);
      if (response.ok) {
        const data = await response.json();
        setAvailableYears(data.years);
        // Set default to most recent year if available
        if (data.years.length > 0) {
          setSelectedYear(data.years[0].toString());
        }
      } else {
        toast({
          title: "Error",
          description: "Failed to fetch available years",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error fetching years:", error);
      toast({
        title: "Error",
        description: "Failed to fetch available years",
        variant: "destructive",
      });
    } finally {
      setIsLoadingYears(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedYear) {
      toast({
        title: "Error",
        description: "Please select a year",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    try {
      const params = new URLSearchParams({
        year: selectedYear,
        charityName,
        charityAddress,
        taxId,
        customNote,
        signatureName,
      });

      const response = await fetch(
        `/api/contacts/${contactId}/end-of-year-letter?${params.toString()}`
      );

      if (response.ok) {
        // Create a blob from the PDF and open in new tab
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        window.open(url, '_blank');

        toast({
          title: "Success",
          description: "End of year letter generated successfully",
        });
        onClose();
      } else {
        const errorData = await response.json();
        toast({
          title: "Error",
          description: errorData.error || "Failed to generate letter",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error generating letter:", error);
      toast({
        title: "Error",
        description: "Failed to generate letter",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleClose = () => {
    setSelectedYear("");
    setAvailableYears([]);
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Generate End of Year Donation Letter</DialogTitle>
          <DialogDescription>
            Select a year and customize the letter details for {contactName}.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Year Selection */}
          <div className="grid gap-2">
            <Label htmlFor="year">Year *</Label>
            {isLoadingYears ? (
              <div className="flex items-center space-x-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Loading years...</span>
              </div>
            ) : (
              <Select value={selectedYear} onValueChange={setSelectedYear}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a year" />
                </SelectTrigger>
                <SelectContent>
                  {availableYears.map((year) => (
                    <SelectItem key={year} value={year.toString()}>
                      {year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            disabled={!selectedYear || isGenerating || availableYears.length === 0}
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