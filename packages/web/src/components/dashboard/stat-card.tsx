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
  className?: string;
}

/**
 * Compact stat card — basalt L2 style (bg-secondary, no border/shadow).
 * Shows title, large value, optional icon, optional trend.
 */
export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-muted-foreground",
  trend,
  trends,
  className,
}: StatCardProps) {
  // Merge single trend + trends array into one list
  const allTrends = trends ?? (trend ? [trend] : []);

  return (
    <div className={cn("rounded-[var(--radius-card)] bg-secondary p-4 md:p-5", className)}>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs md:text-sm text-muted-foreground">{title}</p>
          <p className="text-2xl md:text-3xl font-semibold text-foreground font-display tracking-tight">
            {typeof value === "number" ? value.toLocaleString() : value}
          </p>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {Icon && (
          <div className={cn("rounded-md bg-card p-2", iconColor)}>
            <Icon className="h-5 w-5" strokeWidth={1.5} />
          </div>
        )}
      </div>
      {allTrends.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
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
