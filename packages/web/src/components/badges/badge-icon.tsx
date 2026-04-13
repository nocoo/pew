import { cn } from "@/lib/utils";
import { type BadgeIconType } from "@pew/core";
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

interface BadgeIconProps {
  text: string; // 1-4 chars
  icon: BadgeIconType;
  colorBg: string; // hex for background
  colorText: string; // hex for text
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
  sm: {
    container: "w-7 h-7",
    icon: 28,
    text: "text-[9px]",
  },
  md: {
    container: "w-9 h-9",
    icon: 36,
    text: "text-[11px]",
  },
  lg: {
    container: "w-12 h-12",
    icon: 48,
    text: "text-sm",
  },
} as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Badge icon component for displaying admin-assigned badges.
 *
 * Design: Rounded square with semi-transparent icon background,
 * text centered on top.
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
      className={cn(
        "relative inline-flex items-center justify-center rounded-lg",
        config.container,
        className,
      )}
      style={{ backgroundColor: colorBg }}
      role="img"
      aria-label={`Badge: ${text}`}
    >
      {/* Background icon (semi-transparent) */}
      <IconComponent
        size={config.icon}
        className="absolute opacity-20"
        style={{ color: colorText }}
        strokeWidth={1.5}
      />

      {/* Text overlay */}
      <span
        className={cn(
          "relative z-10 font-bold leading-none",
          config.text,
        )}
        style={{ color: colorText }}
      >
        {text}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export type { BadgeIconProps, BadgeIconType };
