import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// StatCard
// ---------------------------------------------------------------------------

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: LucideIcon;
  iconColor?: string;
  trend?: { value: number; label?: string };
  trends?: { value: number; label?: string }[] | undefined;
  /**
   * Visual variant:
   * - "primary": larger, more prominent (for key metrics like Total Tokens, Est. Cost)
   * - "secondary": compact (default, for supporting metrics)
   */
  variant?: "primary" | "secondary";
  /**
   * Accent bar at top of card — shows a colored line as visual decoration.
   * Pass a Tailwind color class (e.g., "bg-primary", "bg-chart-5").
   */
  accentColor?: string;
  /**
   * Layout mode for trends:
   * - "stacked": trends in a column below the value (default)
   * - "side": trends in a second column beside the value (for primary cards with many trends)
   */
  trendsLayout?: "stacked" | "side";
  className?: string;
}

/**
 * Compact stat card — basalt L2 style (bg-secondary, no border/shadow).
 * Shows title, large value, optional icon, optional trend.
 *
 * Variants:
 * - primary: larger font, gradient accent line, more spacing
 * - secondary: compact, minimal styling
 */
export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-muted-foreground",
  trend,
  trends,
  variant = "secondary",
  accentColor,
  trendsLayout = "stacked",
  className,
}: StatCardProps) {
  // Merge single trend + trends array into one list
  const allTrends = trends ?? (trend ? [trend] : []);

  const isPrimary = variant === "primary";
  const useSideLayout = trendsLayout === "side" && allTrends.length > 0;

  const TrendsContent = allTrends.length > 0 ? (
    <div className={cn(
      "flex flex-col gap-1",
      useSideLayout ? "justify-center" : "mt-3"
    )}>
      {allTrends.map((t, i) => {
        const isPos = t.value > 0;
        const isNeg = t.value < 0;
        return (
          <div key={i} className="flex items-center gap-1 text-xs">
            <span
              className={cn(
                "font-medium",
                isPos && "text-success",
                isNeg && "text-destructive",
                !isPos && !isNeg && "text-muted-foreground"
              )}
            >
              {isPos && "+"}
              {t.value}%
            </span>
            {t.label && (
              <span className="text-muted-foreground">{t.label}</span>
            )}
          </div>
        );
      })}
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "rounded-[var(--radius-card)] bg-secondary",
        isPrimary ? "p-5 md:p-6" : "p-4 md:p-5",
        className
      )}
    >
      {/* Top accent bar — custom color or gradient for primary */}
      {(accentColor || isPrimary) && (
        <div className={cn(
          "h-0.5 w-8 rounded-full mb-4",
          accentColor ?? "bg-gradient-to-r from-primary to-chart-8"
        )} />
      )}

      {/* Side layout: two columns on md+, stacked on mobile */}
      {useSideLayout ? (
        <div className="flex flex-col md:flex-row md:gap-6">
          {/* Left: main content */}
          <div className="flex-1 min-w-0 space-y-1">
            <p
              className={cn(
                "text-muted-foreground",
                isPrimary ? "text-xs md:text-sm font-medium" : "text-xs md:text-sm"
              )}
            >
              {title}
            </p>
            <p
              className={cn(
                "font-semibold text-foreground font-display tracking-tight",
                isPrimary ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl"
              )}
            >
              {typeof value === "number" ? value.toLocaleString() : value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {/* Middle: trends (hidden on mobile, shown below instead) */}
          <div className="hidden md:flex md:items-center md:border-l md:border-border/50 md:pl-6">
            {TrendsContent}
          </div>
          {/* Right: icon */}
          {Icon && (
            <div className="hidden md:flex md:items-start md:shrink-0">
              <div className={cn("rounded-md bg-card p-2", iconColor)}>
                <Icon className={cn(isPrimary ? "h-6 w-6" : "h-5 w-5")} strokeWidth={1.5} />
              </div>
            </div>
          )}
          {/* Mobile: trends below + icon */}
          <div className="md:hidden mt-3 flex items-start justify-between">
            <div className="flex-1">{TrendsContent}</div>
            {Icon && (
              <div className={cn("rounded-md bg-card p-2 shrink-0", iconColor)}>
                <Icon className={cn(isPrimary ? "h-6 w-6" : "h-5 w-5")} strokeWidth={1.5} />
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Stacked layout (default) */
        <>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p
                className={cn(
                  "text-muted-foreground",
                  isPrimary ? "text-xs md:text-sm font-medium" : "text-xs md:text-sm"
                )}
              >
                {title}
              </p>
              <p
                className={cn(
                  "font-semibold text-foreground font-display tracking-tight",
                  isPrimary ? "text-3xl md:text-4xl" : "text-2xl md:text-3xl"
                )}
              >
                {typeof value === "number" ? value.toLocaleString() : value}
              </p>
              {subtitle && (
                <p className="text-xs text-muted-foreground">{subtitle}</p>
              )}
            </div>
            {Icon && (
              <div className={cn("rounded-md bg-card p-2", iconColor)}>
                <Icon className={cn(isPrimary ? "h-6 w-6" : "h-5 w-5")} strokeWidth={1.5} />
              </div>
            )}
          </div>
          {TrendsContent}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// StatGrid
// ---------------------------------------------------------------------------

export interface StatGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

/** Responsive grid layout for stat cards. */
export function StatGrid({ children, columns = 4, className }: StatGridProps) {
  const gridCols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={cn("grid gap-3 md:gap-4", gridCols[columns], className)}>
      {children}
    </div>
  );
}
