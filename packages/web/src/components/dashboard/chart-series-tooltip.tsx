"use client";

import { summarizeTooltipEntries } from "@/lib/chart-tooltip-entries";
import { shortModel } from "@/lib/model-helpers";
import { chartMuted } from "@/lib/palette";
import { formatTokens } from "@/lib/format";
import { ChartTooltip, ChartTooltipRow, ChartTooltipSummary } from "./chart-tooltip";

export function ChartSeriesTooltip({
  entries,
  title,
  percentage = false,
}: {
  entries: readonly { dataKey: string; name?: string; value: number; color: string }[];
  title?: string | undefined;
  percentage?: boolean;
}) {
  const { visible, hiddenCount, hiddenTotal, total } = summarizeTooltipEntries(entries);
  if (visible.length === 0) return null;
  const format = percentage ? (value: number) => `${value.toFixed(1)}%` : formatTokens;
  return (
    <ChartTooltip
      title={title}
      className="pointer-events-auto max-h-[calc(100dvh-2rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
    >
      <div className="space-y-0.5">
        {visible.map((entry) => (
          <ChartTooltipRow
            key={entry.dataKey}
            label={entry.name ?? shortModel(entry.dataKey)}
            color={entry.color}
            value={format(entry.value)}
          />
        ))}
        {hiddenCount > 0 && (
          <ChartTooltipRow
            label={`${hiddenCount} more series`}
            color={chartMuted}
            value={format(hiddenTotal)}
          />
        )}
      </div>
      <ChartTooltipSummary label="Total" value={format(total)} />
    </ChartTooltip>
  );
}
