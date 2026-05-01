interface ErrorBannerProps {
  messagePrefix: string;
  error: string | null | undefined;
}

/**
 * Pure-display fallback for top-level page error states.
 * Renders nothing when `error` is falsy.
 *
 * Intentionally narrow: no retry, no icon, no children, no variant.
 * For richer error UX (inline form errors, retry buttons, icons), build
 * the markup at the call site — this component is only for the
 * `rounded-card bg-destructive/10 p-4 text-sm text-destructive` pattern.
 */
export function ErrorBanner({ messagePrefix, error }: ErrorBannerProps) {
  if (!error) return null;
  return (
    <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
      {messagePrefix}: {error}
    </div>
  );
}
