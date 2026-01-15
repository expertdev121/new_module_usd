import { clsx, type ClassValue } from "clsx";
import { useState, useEffect } from "react";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

export const formatDate = (dateString: string | null) => {
  if (!dateString) return "N/A";
  
  // Parse date components to avoid timezone issues
  const [year, month, day] = dateString.split('-').map(Number);
  if (!year || !month || !day) return "N/A";
  
  // Array of 3-letter uppercase month strings
  const months = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
  ];

  const dayStr = day.toString().padStart(2, "0");
  const monthStr = months[month - 1];

  return `${dayStr}-${monthStr}-${year}`;
};

// Date formatting utilities for forms
export const formatDateForDisplay = (dateString: string | null | undefined): string => {
  if (!dateString) return "";
  try {
    // Parse the YYYY-MM-DD format directly to avoid timezone issues
    const [year, month, day] = dateString.split('-').map(Number);
    if (!year || !month || !day) return "";
    
    const monthStr = month.toString().padStart(2, "0");
    const dayStr = day.toString().padStart(2, "0");
    
    return `${monthStr}/${dayStr}/${year}`;
  } catch {
    return "";
  }
};

export const formatDateForInput = (dateString: string | null | undefined): string => {
  if (!dateString) return "";
  try {
    // If it's already in YYYY-MM-DD format, return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
      return dateString;
    }
    
    // Otherwise parse and format
    const [year, month, day] = dateString.split('-').map(Number);
    if (!year || !month || !day) return "";
    
    const yearStr = year.toString();
    const monthStr = month.toString().padStart(2, "0");
    const dayStr = day.toString().padStart(2, "0");
    
    return `${yearStr}-${monthStr}-${dayStr}`;
  } catch {
    return "";
  }
};

export const parseDateFromDisplay = (displayDate: string): string | null => {
  if (!displayDate) return null;
  try {
    // Parse MM/DD/YYYY format
    const [month, day, year] = displayDate.split("/").map(Number);
    if (!month || !day || !year) return null;
    
    // Validate the date values
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900) {
      return null;
    }
    
    const yearStr = year.toString();
    const monthStr = month.toString().padStart(2, "0");
    const dayStr = day.toString().padStart(2, "0");
    
    return `${yearStr}-${monthStr}-${dayStr}`;
  } catch {
    return null;
  }
};