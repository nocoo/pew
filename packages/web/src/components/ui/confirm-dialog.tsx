/**
 * Reusable confirmation dialog component.
 *
 * Replaces native browser confirm() with a styled Radix Dialog.
 */

"use client";

import { useCallback, useState } from "react";
import { Dialog } from "radix-ui";
import { AlertTriangle, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ConfirmDialogProps {
  /** Dialog open state */
  open: boolean;
  /** Handler called when dialog should close */
  onOpenChange: (open: boolean) => void;
  /** Handler called when user confirms */
  onConfirm: () => void | Promise<void>;
  /** Dialog title */
  title: string;
  /** Dialog description/message */
  description: string;
  /** Text for the confirm button (default: "Confirm") */
  confirmText?: string;
  /** Text for the cancel button (default: "Cancel") */
  cancelText?: string;
  /** Variant affects confirm button styling */
  variant?: "default" | "destructive";
  /** Whether confirm action is in progress (disables buttons) */
  loading?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "default",
  loading = false,
}: ConfirmDialogProps) {
  const handleConfirm = useCallback(async () => {
    await onConfirm();
  }, [onConfirm]);

  const Icon = variant === "destructive" ? Trash2 : AlertTriangle;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl bg-card p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
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
          <div
            className={cn(
              "mx-auto flex h-12 w-12 items-center justify-center rounded-full mb-4",
              variant === "destructive"
                ? "bg-destructive/10 text-destructive"
                : "bg-chart-6/10 text-chart-6"
            )}
          >
            <Icon className="h-6 w-6" strokeWidth={1.5} />
          </div>

          {/* Title */}
          <Dialog.Title className="text-center text-lg font-semibold text-foreground mb-2">
            {title}
          </Dialog.Title>

          {/* Description */}
          <Dialog.Description className="text-center text-sm text-muted-foreground mb-6">
            {description}
          </Dialog.Description>

          {/* Actions */}
          <div className="flex gap-3">
            <Dialog.Close asChild>
              <button
                type="button"
                disabled={loading}
                className="flex-1 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
              >
                {cancelText}
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={loading}
              className={cn(
                "flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50",
                variant === "destructive"
                  ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  : "bg-primary text-primary-foreground hover:bg-primary/90"
              )}
            >
              {loading ? "..." : confirmText}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------------------
// Hook for imperative usage
// ---------------------------------------------------------------------------

interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  cancelText: string;
  variant: "default" | "destructive";
  resolve: ((confirmed: boolean) => void) | null;
}

const initialState: ConfirmState = {
  open: false,
  title: "",
  description: "",
  confirmText: "Confirm",
  cancelText: "Cancel",
  variant: "default",
  resolve: null,
};

export interface UseConfirmOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}

export interface UseConfirmReturn {
  /** Call this to show the dialog and await user response */
  confirm: (options: UseConfirmOptions) => Promise<boolean>;
  /** Props to spread on ConfirmDialog */
  dialogProps: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onConfirm: () => void;
    title: string;
    description: string;
    confirmText: string;
    cancelText: string;
    variant: "default" | "destructive";
  };
}

/**
 * Hook for imperative confirm dialog usage.
 *
 * @example
 * const { confirm, dialogProps } = useConfirm();
 *
 * async function handleDelete() {
 *   const confirmed = await confirm({
 *     title: "Delete item?",
 *     description: "This action cannot be undone.",
 *     variant: "destructive",
 *     confirmText: "Delete",
 *   });
 *   if (!confirmed) return;
 *   // proceed with deletion
 * }
 *
 * return (
 *   <>
 *     <button onClick={handleDelete}>Delete</button>
 *     <ConfirmDialog {...dialogProps} />
 *   </>
 * );
 */
export function useConfirm(): UseConfirmReturn {
  const [state, setState] = useState<ConfirmState>(initialState);

  const confirm = useCallback(
    (options: UseConfirmOptions): Promise<boolean> => {
      return new Promise((resolve) => {
        setState({
          open: true,
          title: options.title,
          description: options.description,
          confirmText: options.confirmText ?? "Confirm",
          cancelText: options.cancelText ?? "Cancel",
          variant: options.variant ?? "default",
          resolve,
        });
      });
    },
    []
  );

  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setState((prev) => {
        prev.resolve?.(false);
        return initialState;
      });
    }
  }, []);

  const handleConfirm = useCallback(() => {
    setState((prev) => {
      prev.resolve?.(true);
      return initialState;
    });
  }, []);

  return {
    confirm,
    dialogProps: {
      open: state.open,
      onOpenChange: handleOpenChange,
      onConfirm: handleConfirm,
      title: state.title,
      description: state.description,
      confirmText: state.confirmText,
      cancelText: state.cancelText,
      variant: state.variant,
    },
  };
}
