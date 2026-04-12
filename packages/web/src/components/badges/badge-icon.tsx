import { cn } from "@/lib/utils";
import {
  Shield,
  Star,
  Hexagon,
  Circle,
  Diamond,
  Crown,
  Flame,
  Zap,
  Heart,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Available badge icons */
export type BadgeIconType =
  | "shield"
  | "star"
  | "hexagon"
  | "circle"
  | "diamond"
  | "crown"
  | "flame"
  | "zap"
  | "heart"
  | "sparkles";

interface BadgeIconProps {
  text: string; // 1-4 chars
  icon: BadgeIconType;
  colorBg: string; // hex for pill background
  colorText: string; // hex for pill text
  size?: "sm" | "md" | "lg";
  className?: string;
}

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

const ICON_MAP: Record<BadgeIconType, LucideIcon> = {
  shield: Shield,
  star: Star,
  hexagon: Hexagon,
  circle: Circle,
  diamond: Diamond,
  crown: Crown,
  flame: Flame,
  zap: Zap,
  heart: Heart,
  sparkles: Sparkles,
};

/**
 * Size configuration for badge dimensions.
 *
 * sm: Compact size for inline use (leaderboard, lists)
 * md: Standard size for profile popup
 * lg: Large size for admin previews
 */
const SIZE_CONFIG = {
  sm: { icon: 16, pill: "text-[8px] px-1 py-0", offset: "-bottom-0.5" },
  md: { icon: 20, pill: "text-[9px] px-1.5 py-0", offset: "-bottom-1" },
  lg: { icon: 28, pill: "text-[10px] px-2 py-0.5", offset: "-bottom-1.5" },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Badge icon component for displaying admin-assigned badges.
 *
 * Design: Lucide icon with a colored pill overlay at the bottom.
 *
 * Used in:
 * - Leaderboard rank column
 * - Profile popup (next to avatar)
 * - Admin badge management (preview)
 */
export function BadgeIcon({
  text,
  icon,
  colorBg,
  colorText,
  size = "md",
  className = "",
}: BadgeIconProps) {
  const config = SIZE_CONFIG[size];
  const IconComponent = ICON_MAP[icon] ?? Star;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      role="img"
      aria-label={`Badge: ${text}`}
    >
      {/* Lucide icon */}
      <IconComponent
        size={config.icon}
        className="text-muted-foreground"
        strokeWidth={1.5}
      />

      {/* Text pill overlay */}
      <span
        className={cn(
          "absolute rounded-full font-semibold whitespace-nowrap",
          config.pill,
          config.offset,
        )}
        style={{ backgroundColor: colorBg, color: colorText }}
      >
        {text}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { BadgeIconProps };
