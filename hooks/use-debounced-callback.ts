import { useCallback, useEffect,useState, useRef } from "react";

export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
): T {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null!);
  
  return useCallback(((...args: Parameters<T>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }) as T, [callback, delay]);
}

export function useDebounce<T>(
  value: T,
  delay: number
): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  const timeoutRef = useRef<NodeJS.Timeout>(null!);

  useEffect(() => {
    timeoutRef.current && clearTimeout(timeoutRef.current);

    timeoutRef.current = setTimeout(() => setDebouncedValue(value), delay);

    return () => {
      timeoutRef.current && clearTimeout(timeoutRef.current);
    };
  }, [value, delay]);

  return debouncedValue;
}

