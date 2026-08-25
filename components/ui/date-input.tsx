"use client";

import React, { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarIcon } from "lucide-react";
import { formatDateForDisplay } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface DateInputProps {
  value?: string | null;
  onChange?: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  readOnly?: boolean;
  className?: string;
}

/**
 * Parse a typed date (MM/DD/YYYY, M/D/YY, with / - or . separators) into the
 * canonical `YYYY-MM-DD` string the app stores. Returns null if it isn't a
 * complete, valid calendar date (so partial typing doesn't commit garbage).
 */
function parseTypedDate(input: string): string | null {
  const m = input.trim().match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length === 2) year += year < 50 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1000) return null;
  const d = new Date(year, month - 1, day, 12, 0, 0);
  // Reject impossible dates like 02/31 (JS rolls them over).
  if (isNaN(d.getTime()) || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Date field that can be BOTH typed and picked. Staff can key a date directly
 * (fast data entry) or click the calendar icon to pick one. Stores/emits
 * `YYYY-MM-DD` strings; displays `MM/DD/YYYY`.
 */
export default function DateInput({
  value,
  onChange,
  placeholder = "MM/DD/YYYY",
  disabled = false,
  readOnly = false,
  className,
}: DateInputProps) {
  const [displayValue, setDisplayValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [visibleMonth, setVisibleMonth] = useState<Date>(new Date());

  // Sync display + calendar state from the value prop — but never while the
  // user is actively typing (that would fight their keystrokes / reformat
  // mid-entry).
  useEffect(() => {
    if (focused) return;
    setDisplayValue(formatDateForDisplay(value));
    if (value) {
      const [year, month, day] = value.split("-").map(Number);
      if (year && month && day) {
        const date = new Date(year, month - 1, day, 12, 0, 0);
        if (!isNaN(date.getTime())) {
          setSelectedDate(date);
          setVisibleMonth(date);
        }
      }
    } else {
      setSelectedDate(undefined);
      setVisibleMonth(new Date());
    }
  }, [value, focused]);

  const commitIso = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    const date = new Date(y, m - 1, d, 12, 0, 0);
    setSelectedDate(date);
    setVisibleMonth(date);
    onChange?.(iso);
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (disabled || readOnly) return;
    const text = e.target.value;
    setDisplayValue(text);
    if (text.trim() === "") {
      setSelectedDate(undefined);
      onChange?.(null);
      return;
    }
    // Only commit once the typed value is a complete, valid date. Partial
    // input (e.g. "8/2") just updates the visible text.
    const iso = parseTypedDate(text);
    if (iso) commitIso(iso);
  };

  const handleBlur = () => {
    setFocused(false);
    const text = displayValue.trim();
    if (text === "") {
      onChange?.(null);
      return;
    }
    const iso = parseTypedDate(text);
    if (iso) {
      setDisplayValue(formatDateForDisplay(iso));
      commitIso(iso);
    }
    // If it doesn't parse, leave the user's text as-is so form validation
    // can flag it, rather than silently wiping their entry.
  };

  const handleDateSelect = (date: Date | undefined) => {
    if (disabled || readOnly) return;
    if (date) {
      const year = date.getFullYear();
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const day = date.getDate().toString().padStart(2, "0");
      const formattedDate = `${year}-${month}-${day}`;
      setDisplayValue(formatDateForDisplay(formattedDate));
      setSelectedDate(date);
      setVisibleMonth(date);
      onChange?.(formattedDate);
    } else {
      setDisplayValue("");
      setSelectedDate(undefined);
      setVisibleMonth(new Date());
      onChange?.(null);
    }
    setIsCalendarOpen(false);
  };

  if (disabled || readOnly) {
    return (
      <div className="relative">
        <Input
          type="text"
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("pr-10", className)}
          readOnly
        />
        <CalendarIcon className="absolute right-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" />
      </div>
    );
  }

  return (
    <div className="relative">
      <Popover open={isCalendarOpen} onOpenChange={setIsCalendarOpen}>
        {/* Editable text field — type the date directly. */}
        <Input
          type="text"
          value={displayValue}
          placeholder={placeholder}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          className={cn("pr-10", className)}
          onChange={handleTextChange}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
        />
        {/* Calendar icon opens the picker (which still works as before). */}
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Open calendar"
            tabIndex={-1}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500/40"
          >
            <CalendarIcon className="h-4 w-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            month={visibleMonth}
            onMonthChange={setVisibleMonth}
            onSelect={handleDateSelect}
            initialFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
