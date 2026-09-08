import { SkeletonLine } from "@nocoo/basalt/components/skeleton-line";
import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

/** Block placeholder. Uses Basalt SkeletonLine shimmer; width comes from className. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <SkeletonLine
      className={cn("max-w-none", className)}
      minWidth={100}
      maxWidth={100}
      style={{ width: undefined }}
    />
  );
}
