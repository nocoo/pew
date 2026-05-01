"use client";

import { Info } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { usePricingEntries } from "@/hooks/use-pricing-entries";
import {
  findPricingEntriesForModel,
  formatContextWindow,
  formatPerMillion,
} from "@/lib/model-info-helpers";
import {
  originChipClass,
  providerIconPath,
  OPENROUTER_FALLBACK_ICON,
} from "@/app/(dashboard)/model-prices/pricing-table-helpers";
import { cn } from "@/lib/utils";

interface Props {
  /** Model identifier — exact match against entry.model or any alias. */
  model: string;
  /** Optional className applied to the trigger icon for layout tweaks. */
  className?: string;
}

/**
 * `(i)` icon that, on hover, shows pricing + metadata for the given
 * model across every origin/provider known to the dynamic pricing KV.
 *
 * Renders nothing if the dataset has not loaded yet AND the icon would
 * have nothing to show anyway — the icon itself is always rendered so
 * layout doesn't shift.
 */
export function ModelInfoTooltip({ model, className }: Props) {
  const { entries, loading, error } = usePricingEntries();
  const matches = findPricingEntriesForModel(entries, model);

  return (
    <HoverCard>
      <HoverCardTrigger asChild>
        <button
          type="button"
          aria-label={`Pricing info for ${model}`}
          className={cn(
            "inline-flex h-3.5 w-3.5 items-center justify-center text-muted-foreground/60 hover:text-foreground transition-colors align-middle",
            className,
          )}
          // Prevent surrounding row click handlers (table expand etc.).
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" strokeWidth={1.5} aria-hidden="true" />
        </button>
      </HoverCardTrigger>
      <HoverCardContent
        align="start"
        sideOffset={6}
        className="w-80 space-y-3"
      >
        <div>
          <div className="font-mono text-xs text-foreground break-all">
            {model}
          </div>
          {matches[0]?.displayName && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {matches[0].displayName}
            </div>
          )}
        </div>

        {loading && matches.length === 0 && (
          <div className="text-xs text-muted-foreground">Loading…</div>
        )}

        {!loading && matches.length === 0 && !error && (
          <div className="text-xs text-muted-foreground">
            No pricing data found for this model.
          </div>
        )}

        {error && matches.length === 0 && (
          <div className="text-xs text-destructive">
            Failed to load pricing: {error}
          </div>
        )}

        {matches.length > 0 && (
          <div className="space-y-2">
            {matches.map((entry) => (
              <ModelPricingRow
                key={`${entry.model}|${entry.provider}|${entry.origin}`}
                entry={entry}
              />
            ))}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}

function ModelPricingRow({
  entry,
}: {
  entry: ReturnType<typeof findPricingEntriesForModel>[number];
}) {
  const ctx = formatContextWindow(entry.contextWindow);
  return (
    <div className="rounded-md border border-border/50 p-2 space-y-1">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1 font-medium text-foreground">
          {(() => {
            const icon = providerIconPath(entry.provider) ?? (entry.origin === "openrouter" ? OPENROUTER_FALLBACK_ICON : null);
            if (!icon) return null;
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={icon.src}
                alt=""
                className={cn("h-3 w-3", icon.invert && "dark:invert")}
              />
            );
          })()}
          {entry.provider}
        </span>
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", originChipClass(entry.origin))}>
          {entry.origin}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1 text-[11px]">
        <PricingCell label="Input" value={formatPerMillion(entry.inputPerMillion)} />
        <PricingCell
          label="Output"
          value={formatPerMillion(entry.outputPerMillion)}
        />
        <PricingCell
          label="Cached"
          value={formatPerMillion(entry.cachedPerMillion)}
        />
      </div>
      {ctx && (
        <div className="text-[11px] text-muted-foreground">
          Context: <span className="font-mono">{ctx}</span>
        </div>
      )}
    </div>
  );
}

function PricingCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-muted-foreground/70">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
