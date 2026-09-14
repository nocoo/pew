"use client";

import { useMemo, useState } from "react";
import { Settings, Target } from "lucide-react";
import { Button } from "@nocoo/basalt/components/button";
import { rowIconClassName } from "@/components/ui/button";
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
  "hsl(var(--basalt-muted))",
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
  const { daysOnTarget, onTargetRate } = useMemo(() => {
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
    return { daysOnTarget: onTarget, onTargetRate: rate };
  }, [data, thresholds]);

  return (
    <div className={cn("min-w-0 flex flex-col", className)}>
      <div className="mb-3 flex min-h-12 items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.5} />
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Goal Tracker</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {daysOnTarget} day{daysOnTarget !== 1 ? "s" : ""} above {formatTokens(thresholds.upper)}/day
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <span className="text-2xl font-bold font-display tracking-tight text-foreground">{onTargetRate}%</span>
            <p className="text-xs text-muted-foreground">on target</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={rowIconClassName}
            onClick={() => setSettingsOpen(true)}
            aria-label="Goal settings"
          >
            <Settings strokeWidth={1.5} />
          </Button>
        </div>
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

      <div className="mt-3 flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/50 pt-2 text-xs text-muted-foreground">
        <span>
          <span
            className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-[-1px]"
            style={{ backgroundColor: goalColorScale[1] }}
          />
          &lt; {formatTokens(thresholds.lower)}
        </span>
        <span>
          <span
            className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-[-1px]"
            style={{ backgroundColor: goalColorScale[2] }}
          />
          {formatTokens(thresholds.lower)} – {formatTokens(thresholds.upper)}
        </span>
        <span>
          <span
            className="inline-block w-2.5 h-2.5 rounded-full mr-1 align-[-1px]"
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
