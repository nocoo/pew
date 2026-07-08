"use client";

import { useCallback, useState } from "react";
import { Dialog } from "radix-ui";
import { Settings, X } from "lucide-react";
import { formatTokensFull } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GOAL_STORAGE_KEY = "pew-goal-thresholds";
export const DEFAULT_LOWER = 50_000_000; // 50M tokens/day
export const DEFAULT_UPPER = 200_000_000; // 200M tokens/day

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
      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Lower threshold (M tokens/day)
          </label>
          <input
            type="number"
            min="0"
            step="any"
            value={lower}
            onChange={(e) => setLower(e.target.value)}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="50"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Below = red · {formatTokensFull(parseFloat(lower || "0") * 1_000_000)} tokens
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Upper threshold (M tokens/day)
          </label>
          <input
            type="number"
            min="0"
            step="any"
            value={upper}
            onChange={(e) => setUpper(e.target.value)}
            className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="200"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Above = green · {formatTokensFull(parseFloat(upper || "0") * 1_000_000)} tokens
          </p>
        </div>

        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 mt-6">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Save
        </button>
      </div>
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
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          {/* Close button */}
          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>

          {/* Icon */}
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
            <Settings className="h-6 w-6" strokeWidth={1.5} />
          </div>

          {/* Title */}
          <Dialog.Title className="text-center text-lg font-semibold text-foreground mb-1">
            Goal Thresholds
          </Dialog.Title>

          <Dialog.Description className="text-center text-sm text-muted-foreground mb-5">
            Set daily token thresholds for the goal heatmap.
          </Dialog.Description>

          {/* Form — remounts each open, resetting state */}
          <GoalSettingsForm
            current={current}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
