import { cn } from "@/lib/utils";

export type MessageBannerMsg = { type: "success" | "error"; text: string };

interface MessageBannerProps {
  message: MessageBannerMsg | null;
  /** Optional extra classes (e.g. spacing like `mb-3`). Appended after variant. */
  className?: string;
}

/**
 * Inline success/error banner for dashboard pages (admin, teams).
 *
 * Renders nothing when `message` is null. Visual style is fixed
 * (`rounded-lg p-3 text-xs`) with success/error variants; spacing
 * differences belong in the caller via `className`.
 */
export function MessageBanner({ message, className }: MessageBannerProps) {
  if (!message) return null;
  return (
    <div
      className={cn(
        "rounded-lg p-3 text-xs",
        message.type === "success"
          ? "bg-success/10 text-success"
          : "bg-destructive/10 text-destructive",
        className,
      )}
    >
      {message.text}
    </div>
  );
}
