import { Skeleton } from "@/components/ui/skeleton";

interface RowListSkeletonProps {
  /** Number of rows to render. */
  rows: number;
  /** Optional leading element className (e.g. "h-10 w-10 rounded-lg" for avatar, "h-8 w-8 rounded" for icon). Omit for no leading element. */
  leadingClassName?: string;
  /** Width classes for skeletons before the flex spacer (e.g. ["w-32", "w-16"]). Each renders as `h-4 <w>`. */
  middle?: string[];
  /** Width classes for skeletons after the flex spacer. Each renders as `h-4 <w>`. */
  tail?: string[];
}

/**
 * Loading skeleton for admin row-list pages (organizations, seasons, invites, badges).
 *
 * Renders the shared shell `rounded-xl bg-secondary p-4` containing a flex row of
 * `h-4` skeletons separated by a flex spacer, with an optional leading element.
 */
export function RowListSkeleton({
  rows,
  leadingClassName,
  middle = [],
  tail = [],
}: RowListSkeletonProps) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl bg-secondary p-4">
          <div className="flex items-center gap-4">
            {leadingClassName ? <Skeleton className={leadingClassName} /> : null}
            {middle.map((w, j) => (
              <Skeleton key={`m${j}`} className={`h-4 ${w}`} />
            ))}
            <div className="flex-1" />
            {tail.map((w, j) => (
              <Skeleton key={`t${j}`} className={`h-4 ${w}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
