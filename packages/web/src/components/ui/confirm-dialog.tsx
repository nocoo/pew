"use client";

import {
  ConfirmDialog as BasaltConfirmDialog,
  useConfirm as useBasaltConfirm,
  type ConfirmDialogProps as BasaltConfirmDialogProps,
  type UseConfirmOptions as BasaltUseConfirmOptions,
} from "@nocoo/basalt/components/confirm-dialog";

export type ConfirmDialogProps = BasaltConfirmDialogProps & {
  confirmText?: string;
  cancelText?: string;
};

export function ConfirmDialog({
  confirmText,
  cancelText,
  confirmLabel,
  cancelLabel,
  ...props
}: ConfirmDialogProps) {
  return (
    <BasaltConfirmDialog
      {...props}
      confirmLabel={confirmLabel ?? confirmText ?? "Confirm"}
      cancelLabel={cancelLabel ?? cancelText ?? "Cancel"}
    />
  );
}

interface UseConfirmOptions {
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
}

export function useConfirm() {
  const { confirm, dialogProps } = useBasaltConfirm();
  return {
    confirm: (options: UseConfirmOptions) => {
      const next: BasaltUseConfirmOptions = {
        title: options.title,
        description: options.description,
      };
      if (options.variant) next.variant = options.variant;
      if (options.confirmText) next.confirmLabel = options.confirmText;
      if (options.cancelText) next.cancelLabel = options.cancelText;
      return confirm(next);
    },
    dialogProps,
  };
}
