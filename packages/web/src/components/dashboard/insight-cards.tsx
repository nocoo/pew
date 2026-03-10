"use client";

import {
  Crown,
  Wrench,
  Zap,
  Clock,
  Flame,
  Trophy,
  Brain,
  Gauge,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Insight } from "@/lib/insights";

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

const iconMap: Record<string, LucideIcon> = {
  Crown,
  Wrench,
  Zap,
  Clock,
  Flame,
  Trophy,
  Brain,
  Gauge,
  Sparkles,
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface InsightCardsProps {
  insights: Insight[];
  className?: string;
}

interface InsightCardProps {
  insight: Insight;
}

// ---------------------------------------------------------------------------
// Single card
// ---------------------------------------------------------------------------

function InsightCard({ insight }: InsightCardProps) {
  const Icon = iconMap[insight.icon] ?? Sparkles;

  // Parse markdown bold (**text**) into <strong> elements
  const parts = insight.description.split(/\*\*(.+?)\*\*/g);

  return (
    <div
      className={cn(
        "min-w-[220px] flex-shrink-0 rounded-[var(--radius-card)]",
        "border border-border/50 bg-secondary p-4",
        "flex flex-col gap-2",
      )}
    >
      <div className="flex items-center gap-2">
        <div className="rounded-md bg-card p-1.5 text-muted-foreground">
          <Icon className="h-4 w-4" strokeWidth={1.5} />
        </div>
        <span className="text-xs font-medium text-muted-foreground">
          {insight.title}
        </span>
      </div>
      <p className="text-sm leading-snug text-foreground">
        {parts.map((part, i) =>
          i % 2 === 1 ? (
            <strong key={i} className="font-semibold">
              {part}
            </strong>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scrollable row
// ---------------------------------------------------------------------------

/**
 * Horizontal scrollable row of personal insight cards.
 *
 * Renders "Spotify Wrapped"-style fun facts from usage data.
 * Place between the stat grid and charts on the dashboard for
 * prime engagement real estate.
 */
export function InsightCards({ insights, className }: InsightCardsProps) {
  if (insights.length === 0) return null;

  return (
    <div
      className={cn(
        "flex gap-3 overflow-x-auto pb-1",
        // Hide scrollbar on webkit/firefox
        "[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]",
        className,
      )}
    >
      {insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} />
      ))}
    </div>
  );
}
