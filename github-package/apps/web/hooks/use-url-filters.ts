"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

type FilterValue = string | number | boolean | null | undefined;
type FilterState = Record<string, FilterValue>;

export function useUrlFilters<TFilters extends FilterState>(defaults: TFilters) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const initialFilters = useMemo(() => {
    const next = { ...defaults };

    for (const key of Object.keys(defaults) as Array<keyof TFilters>) {
      const value = searchParams.get(String(key));
      if (value !== null) {
        next[key] = coerceUrlValue(value, defaults[key]) as TFilters[typeof key];
      }
    }

    return next;
  }, [defaults, searchParams]);

  const [filters, setFiltersState] = useState<TFilters>(initialFilters);

  const replaceUrl = useCallback(
    (nextFilters: TFilters) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(nextFilters)) {
        const defaultValue = defaults[key];
        const shouldClear =
          value === undefined ||
          value === null ||
          value === "" ||
          value === defaultValue ||
          (typeof value === "number" && Number.isNaN(value));

        if (shouldClear) {
          params.delete(key);
        } else {
          params.set(key, String(value));
        }
      }

      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [defaults, pathname, router, searchParams],
  );

  const setFilters = useCallback(
    (updater: Partial<TFilters> | ((current: TFilters) => TFilters)) => {
      setFiltersState((current) => {
        const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
        replaceUrl(next);
        return next;
      });
    },
    [replaceUrl],
  );

  const resetFilters = useCallback(() => {
    setFiltersState(defaults);
    replaceUrl(defaults);
  }, [defaults, replaceUrl]);

  return {
    filters,
    setFilters,
    resetFilters,
    searchParams,
  };
}

function coerceUrlValue(value: string, defaultValue: FilterValue) {
  if (typeof defaultValue === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : defaultValue;
  }

  if (typeof defaultValue === "boolean") {
    return value === "true";
  }

  return value;
}
