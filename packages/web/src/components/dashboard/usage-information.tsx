"use client";

import { useMemo, type ReactNode } from "react";
import type { AccountedUsage } from "@/lib/accounting";
import type { PricingMap } from "@/lib/pricing";
import { usageInformation } from "@/lib/usage-information";
import { InfoTooltip } from "@/components/info-tooltip";

export function UsageInformation({ records, pricingMap, loading = false, label = "Usage information", children }: {
  records: readonly (AccountedUsage & { approximate_tokens?: number })[];
  pricingMap: PricingMap;
  loading?: boolean;
  label?: string;
  children?: ReactNode;
}) {
  const notes = useMemo(() => usageInformation(records, pricingMap, loading), [records, pricingMap, loading]);
  if (notes.length === 0 && !children) return null;
  return <InfoTooltip label={label}>
    {children}
    {notes.map((note) => <p key={note}>{note}</p>)}
  </InfoTooltip>;
}
