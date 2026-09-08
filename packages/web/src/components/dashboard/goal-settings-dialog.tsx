"use client";

import { useCallback, useId, useState } from "react";
import { Button } from "@nocoo/basalt/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nocoo/basalt/components/dialog";
import { Field } from "@nocoo/basalt/components/field";
import { Input } from "@nocoo/basalt/components/input";
import { Settings } from "lucide-react";
import { formatTokensFull } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOAL_STORAGE_KEY = "pew-goal-thresholds";
const DEFAULT_LOWER = 50_000_000; // 50M tokens/day
const DEFAULT_UPPER = 200_000_000; // 200M tokens/day

export interface GoalThresholds {
  lower: number;
  upper: number;
}

export function loadGoalThresholds(): GoalThresholds {
  if (typeof window === "undefined") {
    return { lower: DEFAULT_LOWER, upper: DEFAULT_UPPER };
  }
  try {
    const raw = localStorage.getItem(GOAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GoalThresholds;
      if (
        typeof parsed.lower === "number" &&
        typeof parsed.upper === "number" &&
        parsed.lower > 0 &&
        parsed.upper > parsed.lower
      ) {
        return parsed;
      }
    }
  } catch {
    // Corrupted — fall back to defaults
  }
  return { lower: DEFAULT_LOWER, upper: DEFAULT_UPPER };
}

function saveGoalThresholds(thresholds: GoalThresholds): void {
  localStorage.setItem(GOAL_STORAGE_KEY, JSON.stringify(thresholds));
}

// ---------------------------------------------------------------------------
// Inner form — mounts fresh each time dialog opens (no stale state)
// ---------------------------------------------------------------------------

function GoalSettingsForm({
  current,
  onSave,
  onCancel,
}: {
  current: GoalThresholds;
  onSave: (thresholds: GoalThresholds) => void;
  onCancel: () => void;
}) {
  const [lower, setLower] = useState(() => String(current.lower / 1_000_000));
  const [upper, setUpper] = useState(() => String(current.upper / 1_000_000));
  const [error, setError] = useState("");
  const uid = useId();
  const lowerId = `${uid}-lower`;
  const upperId = `${uid}-upper`;

  const handleSave = useCallback(() => {
    const lowerVal = parseFloat(lower) * 1_000_000;
    const upperVal = parseFloat(upper) * 1_000_000;

    if (Number.isNaN(lowerVal) || Number.isNaN(upperVal)) {
      setError("Please enter valid numbers.");
      return;
    }
    if (lowerVal <= 0) {
      setError("Lower threshold must be greater than 0.");
      return;
    }
    if (upperVal <= lowerVal) {
      setError("Upper threshold must be greater than lower.");
      return;
    }

    const thresholds: GoalThresholds = { lower: lowerVal, upper: upperVal };
    saveGoalThresholds(thresholds);
    onSave(thresholds);
  }, [lower, upper, onSave]);

  return (
    <>
      <div className="space-y-4">
        <Field
          label="Lower threshold (M tokens/day)"
          htmlFor={lowerId}
          hint={`Below = red · ${formatTokensFull(parseFloat(lower || "0") * 1_000_000)} tokens`}
        >
          <Input
            id={lowerId}
            type="number"
            min="0"
            step="any"
            value={lower}
            onChange={(e) => setLower(e.target.value)}
            placeholder="50"
          />
        </Field>

        <Field
          label="Upper threshold (M tokens/day)"
          htmlFor={upperId}
          hint={`Above = green · ${formatTokensFull(parseFloat(upper || "0") * 1_000_000)} tokens`}
          {...(error ? { error } : {})}
        >
          <Input
            id={upperId}
            type="number"
            min="0"
            step="any"
            value={upper}
            onChange={(e) => setUpper(e.target.value)}
            placeholder="200"
          />
        </Field>
      </div>

      <DialogFooter>
        <Button variant="outline" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={handleSave}>
          Save
        </Button>
      </DialogFooter>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialog wrapper
// ---------------------------------------------------------------------------

export interface GoalSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (thresholds: GoalThresholds) => void;
  current: GoalThresholds;
}

export function GoalSettingsDialog({
  open,
  onOpenChange,
  onSave,
  current,
}: GoalSettingsDialogProps) {
  const handleSave = useCallback(
    (thresholds: GoalThresholds) => {
      onSave(thresholds);
      onOpenChange(false);
    },
    [onSave, onOpenChange],
  );

  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-basalt-primary/10 text-basalt-primary">
          <Settings className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <DialogHeader className="text-center">
          <DialogTitle className="text-center text-lg">Goal Thresholds</DialogTitle>
          <DialogDescription className="text-center text-sm">
            Set daily token thresholds for the goal heatmap.
          </DialogDescription>
        </DialogHeader>
        <GoalSettingsForm
          current={current}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
}
