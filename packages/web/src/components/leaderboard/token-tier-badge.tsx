import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// ---------------------------------------------------------------------------
// Token Tier Badge — "Asset Notation" style
// ---------------------------------------------------------------------------
// Displays a pill badge using asset-style notation:
//   A4.1  = 1,000–1,999         (4-digit number, leading digit 1)
//   A7.5  = 50,000,000–59,999,999 (7-digit, leading 5)
//   A10.1 = 1,000,000,000+      (10-digit, leading 1)
//
// Colors rotate through 24 hues (HSL hue 0°–345° in 15° steps).
// Digit count 4 maps to hue index 0, 5 → 1, … wrapping at 24.
//
// Below 1,000 = nothing rendered.
// ---------------------------------------------------------------------------

interface TierInfo {
  /** Display label, e.g. "A8.3" */
  label: string;
  /** Number of digits = magnitude */
  digits: number;
  /** Leading digit */
  leading: number;
  /** Human-readable tooltip */
  tooltip: string;
}

/** 24 hues evenly spaced around the color wheel (0°–345°, 15° steps). */
const HUE_COUNT = 24;
const HUE_STEP = 15; // 360 / 24

function tierColor(digits: number): { bg: string; fg: string } {
  const idx = (digits - 4) % HUE_COUNT;
  const hue = ((idx < 0 ? idx + HUE_COUNT : idx) * HUE_STEP);
  return {
    bg: `hsla(${hue}, 70%, 50%, 0.15)`,
    fg: `hsl(${hue}, 70%, 50%)`,
  };
}

const MAGNITUDE_NAMES: Record<number, string> = {
  4: "Thousands",
  5: "Ten-thousands",
  6: "Hundred-thousands",
  7: "Millions",
  8: "Ten-millions",
  9: "Hundred-millions",
  10: "Billions",
  11: "Ten-billions",
  12: "Hundred-billions",
  13: "Trillions",
};

function resolveTier(totalTokens: number): TierInfo | null {
  if (totalTokens < 1_000) return null;

  const digits = Math.floor(Math.log10(totalTokens)) + 1;
  const leading = Math.floor(totalTokens / Math.pow(10, digits - 1));
  const magnitudeName = MAGNITUDE_NAMES[digits] ?? `${digits}-digit`;

  return {
    label: `A${digits}.${leading}`,
    digits,
    leading,
    tooltip: `${magnitudeName} — ${totalTokens.toLocaleString("en-US")} tokens`,
  };
}

export function TokenTierBadge({ totalTokens }: { totalTokens: number }) {
  const tier = resolveTier(totalTokens);
  if (!tier) return null;

  const { bg, fg } = tierColor(tier.digits);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center justify-center rounded-full px-1.5 py-px text-[10px] font-bold leading-tight tracking-wide cursor-default"
          style={{ backgroundColor: bg, color: fg }}
        >
          {tier.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">{tier.tooltip}</TooltipContent>
    </Tooltip>
  );
}
