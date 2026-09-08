import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

/** Animated skeleton placeholder for loading states. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-basalt-muted", className)}
    />
  );
}
