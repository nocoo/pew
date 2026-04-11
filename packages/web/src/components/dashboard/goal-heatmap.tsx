"use client";

import { useMemo, useState } from "react";
import { Settings, Target } from "lucide-react";
import { cn, formatTokens } from "@/lib/utils";
import { HeatmapCalendar, type HeatmapDataPoint } from "./heatmap-calendar";
import {
  GoalSettingsDialog,
  loadGoalThresholds,
  type GoalThresholds,
} from "./goal-settings-dialog";

// ---------------------------------------------------------------------------
// Color scale — traffic-light: [empty, red, yellow, green]
// ---------------------------------------------------------------------------

const goalColorScale = [
  "hsl(var(--muted))",
  "hsl(var(--heatmap-goal-red))",
  "hsl(var(--heatmap-goal-yellow))",
  "hsl(var(--heatmap-goal-green))",
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface GoalHeatmapProps {
  data: HeatmapDataPoint[];
  year: number;
  className?: string;
}

export function GoalHeatmap({ data, year, className }: GoalHeatmapProps) {
  const [thresholds, setThresholds] = useState<GoalThresholds>(loadGoalThresholds);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Boundaries for 3-level bucketing: [lower, upper]
  // getColorIndex: 0=empty, 0<v≤lower → 1 (red), lower<v≤upper → 2 (yellow), v>upper → 3 (green)
  const boundaries = useMemo(
    () => [thresholds.lower, thresholds.upper],
    [thresholds],
  );

  // Compute stats from data
  const { daysOnTarget, achievementRate } = useMemo(() => {
    let onTarget = 0;
    let activeDays = 0;
    for (const d of data) {
      if (d.value > 0) {
        activeDays++;
        if (d.value > thresholds.upper) {
          onTarget++;
        }
      }
    }
    const rate = activeDays > 0 ? Math.round((onTarget / activeDays) * 100) : 0;
    return { daysOnTarget: onTarget, achievementRate: rate };
  }, [data, thresholds]);

  return (
    <div className={cn("min-w-0 flex flex-col", className)}>
      {/* Section title */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Goal Tracker
          </span>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Goal settings"
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {/* Header: achievement rate + days on target — fixed height for alignment */}
      <div className="mb-3 h-14">
        <div className="flex items-baseline gap-1.5">
          <span className="text-2xl md:text-3xl font-bold font-display tracking-tight text-foreground">
            {achievementRate}%
          </span>
          <span className="text-xs text-muted-foreground">on target</span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {daysOnTarget} day{daysOnTarget !== 1 ? "s" : ""} above {formatTokens(thresholds.upper)}/day
        </p>
      </div>

      {/* Heatmap — flex-1 to push footer down */}
      <div className="flex-1">
        <HeatmapCalendar
        data={data}
        year={year}
        colorScale={goalColorScale}
        boundaries={boundaries}
        valueFormatter={(v) => formatTokens(v)}
          metricLabel="Tokens"
          legendLabels={["Below", "Above"]}
        />
      </div>

      {/* Threshold hints — fixed height for alignment across cards */}
      <div className="mt-auto flex h-10 flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/50 pt-3 text-xs text-muted-foreground">
        <span>
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-[-1px]"
            style={{ backgroundColor: goalColorScale[1] }}
          />
          &lt; {formatTokens(thresholds.lower)}
        </span>
        <span>
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-[-1px]"
            style={{ backgroundColor: goalColorScale[2] }}
          />
          {formatTokens(thresholds.lower)} – {formatTokens(thresholds.upper)}
        </span>
        <span>
          <span
            className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-[-1px]"
            style={{ backgroundColor: goalColorScale[3] }}
          />
          &gt; {formatTokens(thresholds.upper)}
        </span>
      </div>

      {/* Settings dialog */}
      <GoalSettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSave={setThresholds}
        current={thresholds}
      />
    </div>
  );
}
