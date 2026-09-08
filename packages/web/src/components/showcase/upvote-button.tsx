"use client";

import { useState, useCallback } from "react";
import { Button } from "@nocoo/basalt/components/button";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface UpvoteButtonProps {
  showcaseId: string;
  initialCount: number;
  initialUpvoted: boolean | null;
  isLoggedIn: boolean;
  onLoginRequired?: (() => void) | undefined;
  onUpvoteChange?: (() => void) | undefined;
  disabled?: boolean;
}

interface OverrideState {
  count: number;
  upvoted: boolean;
}

export function UpvoteButton({
  showcaseId,
  initialCount,
  initialUpvoted,
  isLoggedIn,
  onLoginRequired,
  onUpvoteChange,
  disabled = false,
}: UpvoteButtonProps) {
  const [override, setOverride] = useState<OverrideState | null>(null);
  const [loading, setLoading] = useState(false);

  // Reset optimistic override when parent props change (update-state-during-render pattern)
  const [prevInitialCount, setPrevInitialCount] = useState(initialCount);
  const [prevInitialUpvoted, setPrevInitialUpvoted] = useState(initialUpvoted);
  if (prevInitialCount !== initialCount || prevInitialUpvoted !== initialUpvoted) {
    setPrevInitialCount(initialCount);
    setPrevInitialUpvoted(initialUpvoted);
    setOverride(null);
  }

  const count = override?.count ?? initialCount;
  const upvoted = override?.upvoted ?? initialUpvoted === true;

  const handleClick = useCallback(async () => {
    if (!isLoggedIn) {
      onLoginRequired?.();
      return;
    }

    if (loading || disabled) return;

    const prevOverride = override;
    const nextUpvoted = !upvoted;
    const nextCount = upvoted ? count - 1 : count + 1;
    setOverride({ count: nextCount, upvoted: nextUpvoted });
    setLoading(true);

    try {
      const res = await fetch(`/api/showcases/${showcaseId}/upvote`, {
        method: "POST",
      });

      if (!res.ok) {
        setOverride(prevOverride);
        return;
      }

      const data = (await res.json()) as { upvoted: boolean; upvote_count: number };
      setOverride({ count: data.upvote_count, upvoted: data.upvoted });
      onUpvoteChange?.();
    } catch {
      setOverride(prevOverride);
    } finally {
      setLoading(false);
    }
  }, [showcaseId, count, upvoted, override, loading, disabled, isLoggedIn, onLoginRequired, onUpvoteChange]);

  return (
    <Button
      type="button"
      variant={upvoted ? "secondary" : "outline"}
      onClick={handleClick}
      disabled={loading || disabled}
      loading={loading}
      className={cn(
        "h-auto min-w-[56px] flex-col gap-0.5 px-3 py-2",
        upvoted && "text-basalt-primary",
      )}
      aria-label={!isLoggedIn ? "Login to upvote" : upvoted ? "Remove upvote" : "Upvote"}
    >
      <ChevronUp
        className={cn(
          "h-4 w-4 transition-transform",
          upvoted && "text-primary"
        )}
        strokeWidth={2}
      />
      <span className={cn("text-xs font-semibold tabular-nums", upvoted && "text-primary")}>
        {count}
      </span>
    </Button>
  );
}
