"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildSelectAllOption,
  resolveSelectAllChange,
  sanitizeSelected,
} from "@/lib/toolbarMultiSelect";

function readCachedSelection(cacheKey: string): string[] {
  try {
    const cached = JSON.parse(window.localStorage.getItem(cacheKey) || "[]");
    return Array.isArray(cached) ? cached.map((value) => String(value)) : [];
  } catch {
    return [];
  }
}

export interface ToolbarSelectOption {
  label: string;
  value: string;
  disabled?: boolean;
}

export interface UseToolbarMultiSelectOptions {
  allValues: string[];
  selectAllToken: string;
  selectAllLabel: string;
  cacheKey?: string;
  defaultSelectAll?: boolean;
  itemOptions?: ToolbarSelectOption[];
}

export function useToolbarMultiSelect(options: UseToolbarMultiSelectOptions) {
  const {
    allValues,
    selectAllToken,
    selectAllLabel,
    cacheKey,
    defaultSelectAll = true,
    itemOptions,
  } = options;

  const [selected, setSelectedState] = useState<string[]>([]);
  const hasHydratedSelectionRef = useRef(false);
  const isApplyingInitialSelectionRef = useRef(false);

  const setSelected = useCallback(
    (value: string[]) => {
      setSelectedState(value);
      if (isApplyingInitialSelectionRef.current || !cacheKey) return;
      try {
        window.localStorage.setItem(cacheKey, JSON.stringify(value));
      } catch {}
    },
    [cacheKey]
  );

  const sanitized = useMemo(
    () => sanitizeSelected(selected, allValues),
    [selected, allValues]
  );

  const selectOptions = useMemo(() => {
    const selectAllOption = buildSelectAllOption(allValues.length, selectAllLabel);
    return [
      { ...selectAllOption, value: selectAllToken },
      ...(itemOptions ??
        allValues.map((value) => ({
          label: value,
          value,
        }))),
    ];
  }, [allValues, itemOptions, selectAllLabel, selectAllToken]);

  const handleChange = useCallback(
    (vals: string[]) => {
      const picked = [...new Set(vals)];
      setSelected(resolveSelectAllChange(picked, selectAllToken, allValues));
    },
    [allValues, selectAllToken, setSelected]
  );

  useEffect(() => {
    if (!allValues.length) return;

    isApplyingInitialSelectionRef.current = true;
    setSelectedState((prev) => {
      const cached = cacheKey
        ? readCachedSelection(cacheKey).filter((name) => allValues.includes(name))
        : [];

      if (!hasHydratedSelectionRef.current) {
        hasHydratedSelectionRef.current = true;
        if (cached.length > 0) return cached;
      }

      if (cached.length > 0) return cached;

      if (prev.length > 0) {
        return sanitizeSelected(prev, allValues);
      }

      return defaultSelectAll ? [...allValues] : [];
    });
    isApplyingInitialSelectionRef.current = false;
  }, [allValues, cacheKey, defaultSelectAll]);

  const persistSelection = useCallback(
    (value: string[]) => {
      if (!cacheKey) return;
      try {
        window.localStorage.setItem(cacheKey, JSON.stringify(value));
      } catch {}
    },
    [cacheKey]
  );

  return {
    selected,
    setSelected,
    sanitized,
    selectOptions,
    handleChange,
    persistSelection,
  };
}
