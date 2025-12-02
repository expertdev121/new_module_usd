"use client";

import React, { useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { CalendarIcon, X } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface DateRangePickerProps {
  startDate?: Date | null;
  endDate?: Date | null;
  onChange?: (startDate: Date | null, endDate: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function DateRangePicker({
  startDate,
  endDate,
  onChange,
  placeholder = "Select date range",
  disabled = false,
  className,
}: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);

  const selectedRange = startDate && endDate ? {
    from: startDate,
    to: endDate,
  } : startDate ? {
    from: startDate,
    to: undefined,
  } : undefined;

  const handleSelect = (range: any) => {
    if (range?.from && range?.to) {
      onChange?.(range.from, range.to);
      setIsOpen(false);
    } else if (range?.from) {
      onChange?.(range.from, null);
    }
  };

  const handleClear = () => {
    onChange?.(null, null);
    setIsOpen(false);
  };

  const displayValue = startDate && endDate
    ? `${format(startDate, "MM/dd/yyyy")} - ${format(endDate, "MM/dd/yyyy")}`
    : startDate
    ? `${format(startDate, "MM/dd/yyyy")} - Select end date`
    : placeholder;

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("w-full justify-start text-left font-normal", className)}
          disabled={disabled}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />
          {displayValue}
          {(startDate || endDate) && (
            <X
              className="ml-auto h-4 w-4 opacity-50 hover:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                handleClear();
              }}
            />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="p-3">
          <Calendar
            mode="range"
            selected={selectedRange}
            onSelect={handleSelect}
            numberOfMonths={2}
            initialFocus
          />
          <div className="flex justify-between mt-3">
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Cancel
            </Button>
            <Button variant="outline" onClick={handleClear}>
              Clear
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
