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
 * Parse a typed date (MM/DD/YYYY, M/D/YY, with / - or . separators — or the
 * unpunctuated MMDDYYYY, e.g. "08212026") into the canonical `YYYY-MM-DD`
 * string the app stores. Returns null if it isn't a complete, valid calendar
 * date (so partial typing doesn't commit garbage).
 */
function parseTypedDate(input: string): string | null {
  const trimmed = input.trim();
  const separated = trimmed.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  const compact = trimmed.match(/^(\d{2})(\d{2})(\d{4})$/);
  const m = separated ?? compact;
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
 * Auto-insert "/" separators as digits are typed, so "08212026" and
 * "08/21/2026" converge on the same displayed "08/21/2026" while typing —
 * matching the standard MM/DD/YYYY masked-input pattern (2-digit month,
 * 2-digit day; a leading zero is expected for single-digit months/days,
 * same as a typical date-of-birth mask). Any non-digit the user typed
 * (their own "/", "-", etc.) is stripped and rebuilt, so it never conflicts
 * with the auto-inserted separator.
 */
function autoFormatTypedDate(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  let out = digits.slice(0, 2);
  if (digits.length >= 3) out += "/" + digits.slice(2, 4);
  if (digits.length >= 5) out += "/" + digits.slice(4, 8);
  return out;
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
  // Set on blur when the typed text doesn't parse to a real date. The typed
  // text is intentionally left in place (not wiped) so the user can see and
  // fix what they entered; this flag drives the inline error message below.
  const [hasError, setHasError] = useState(false);

  // Sync display + calendar state from the value prop — but never while the
  // user is actively typing (that would fight their keystrokes / reformat
  // mid-entry).
  useEffect(() => {
    if (focused) return;
    setHasError(false);
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
    const raw = e.target.value;
    // Editing again after an error clears it — re-validated on the next blur.
    if (hasError) setHasError(false);
    if (raw.trim() === "") {
      setDisplayValue("");
      setSelectedDate(undefined);
      onChange?.(null);
      return;
    }
    const text = autoFormatTypedDate(raw);
    setDisplayValue(text);
    // Only commit once the typed value is a complete, valid date. Partial
    // input (e.g. "08/2") just updates the visible text.
    const iso = parseTypedDate(text);
    if (iso) commitIso(iso);
  };

  const handleBlur = () => {
    setFocused(false);
    const text = displayValue.trim();
    if (text === "") {
      setHasError(false);
      onChange?.(null);
      return;
    }
    const iso = parseTypedDate(text);
    if (iso) {
      setHasError(false);
      setDisplayValue(formatDateForDisplay(iso));
      commitIso(iso);
      return;
    }
    // Doesn't parse: leave the user's text as-is (don't silently wipe their
    // entry) and surface a clear inline error instead.
    setHasError(true);
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
    <div>
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
            aria-invalid={hasError || undefined}
            className={cn(
              "pr-10",
              hasError && "border-red-500 focus-visible:ring-red-500/40",
              className,
            )}
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
      {hasError && (
        <p className="mt-1 text-xs text-red-600">
          Enter a valid date (MM/DD/YYYY)
        </p>
      )}
    </div>
  );
}
