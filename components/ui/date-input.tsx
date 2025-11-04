"use client";

import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { formatDateForDisplay, formatDateForInput, parseDateFromDisplay } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface DateInputProps {
  value?: string | null;
  onChange?: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function DateInput({
  value,
  onChange,
  placeholder = "MM/DD/YYYY",
  disabled = false,
  className,
}: DateInputProps) {
  const [displayValue, setDisplayValue] = useState("");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();

  // Update display value and selected date when value prop changes
  useEffect(() => {
    setDisplayValue(formatDateForDisplay(value));
    if (value) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        setSelectedDate(date);
      }
    } else {
      setSelectedDate(undefined);
    }
  }, [value]);

  const handleDateSelect = (date: Date | undefined) => {
    if (date) {
      // Use local date components to avoid timezone issues
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, '0');
      const day = date.getDate().toString().padStart(2, '0');
      const formattedDate = `${year}-${month}-${day}`;
      setDisplayValue(formatDateForDisplay(formattedDate));
      setSelectedDate(date);
      onChange?.(formattedDate);
    } else {
      setDisplayValue("");
      setSelectedDate(undefined);
      onChange?.(null);
    }
    setIsCalendarOpen(false);
  };

  return (
    <div className="relative">
      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Input
              type="text"
              value={displayValue}
              placeholder={placeholder}
              disabled={disabled}
              className={cn("pr-10 cursor-pointer", className)}
              readOnly
            />
            <CalendarIcon className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
          </div>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
