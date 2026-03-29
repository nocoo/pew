"use client";

/**
 * Budget settings dialog — modal for setting monthly cost & token limits.
 *
 * Uses Radix Dialog primitive for accessibility. Triggers PUT /api/budgets
 * via the `saveBudget` callback from useBudget hook.
 */

import { useState, useEffect } from "react";
import { Dialog } from "radix-ui";
import { Settings, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { Budget } from "@/hooks/use-budget";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface BudgetDialogProps {
  budget: Budget | null;
  saveBudget: (input: Partial<Budget>) => Promise<void>;
  deleteBudget: () => Promise<void>;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BudgetDialog({ budget, saveBudget, deleteBudget, className }: BudgetDialogProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [costInput, setCostInput] = useState("");
  const [tokenInput, setTokenInput] = useState("");

  // Sync inputs when dialog opens or budget changes
  useEffect(() => {
    if (open) {
      setCostInput(budget?.budget_usd != null ? String(budget.budget_usd) : "");
      setTokenInput(budget?.budget_tokens != null ? String(budget.budget_tokens) : "");
      setError(null);
    }
  }, [open, budget]);

  async function handleSave() {
    setError(null);

    const budgetUsd = costInput.trim() !== "" ? Number(costInput) : null;
    const budgetTokens = tokenInput.trim() !== "" ? Number(tokenInput) : null;

    // Client-side validation
    if (budgetUsd === null && budgetTokens === null) {
      setError("Set at least one budget limit");
      return;
    }
    if (budgetUsd !== null && (isNaN(budgetUsd) || budgetUsd < 0)) {
      setError("Cost limit must be a non-negative number");
      return;
    }
    if (budgetTokens !== null && (isNaN(budgetTokens) || budgetTokens < 0)) {
      setError("Token limit must be a non-negative number");
      return;
    }

    setSaving(true);
    try {
      await saveBudget({
        budget_usd: budgetUsd,
        budget_tokens: budgetTokens,
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save budget");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setError(null);
    setDeleting(true);
    try {
      await deleteBudget();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear budget");
    } finally {
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon-xs" className={cn("text-muted-foreground", className)}>
          <Settings className="size-3.5" />
          <span className="sr-only">Budget settings</span>
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Monthly Budget
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-xs">
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-muted-foreground mb-5">
            Set spending limits for the current month. Leave a field empty for no limit.
          </Dialog.Description>

          <div className="space-y-4">
            {/* Cost limit */}
            <div className="space-y-1.5">
              <label htmlFor="budget-cost" className="text-sm font-medium text-foreground">
                Monthly cost limit ($)
              </label>
              <input
                id="budget-cost"
                type="number"
                min="0"
                step="0.01"
                placeholder="e.g. 100"
                value={costInput}
                onChange={(e) => setCostInput(e.target.value)}
                className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              />
            </div>

            {/* Token limit */}
            <div className="space-y-1.5">
              <label htmlFor="budget-tokens" className="text-sm font-medium text-foreground">
                Monthly token limit
              </label>
              <input
                id="budget-tokens"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 1000000"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm text-foreground shadow-xs outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}
          </div>

          {/* Actions */}
          <div className="mt-6 flex justify-between">
            {budget ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDelete}
                disabled={busy}
                className="text-destructive hover:text-destructive"
              >
                {deleting && <Loader2 className="size-3.5 animate-spin" />}
                Clear Budget
              </Button>
            ) : (
              <div />
            )}
            <div className="flex gap-2">
              <Dialog.Close asChild>
                <Button variant="outline" size="sm" disabled={busy}>
                  Cancel
                </Button>
              </Dialog.Close>
              <Button size="sm" onClick={handleSave} disabled={busy}>
                {saving && <Loader2 className="size-3.5 animate-spin" />}
                Save
              </Button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
