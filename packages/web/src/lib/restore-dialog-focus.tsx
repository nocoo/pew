"use client";

import { useRef } from "react";

export function useRestoreDialogFocus(open: boolean) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(open);
  if (open && !wasOpenRef.current) {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;
  return (event: { preventDefault: () => void }) => {
    event.preventDefault();
    restoreFocusRef.current?.focus();
  };
}
