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
      const response = await fetch(
        `/api/contacts/${contactId}/end-of-year-letter?year=${selectedYear}`
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
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Generate End of Year Donation Letter</DialogTitle>
          <DialogDescription>
            Select a year to generate a donation letter for {contactName}.
            The letter will include all payments and donations made during that year.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-4 items-center gap-4">
            <label htmlFor="year" className="text-right">
              Year
            </label>
            <div className="col-span-3">
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
