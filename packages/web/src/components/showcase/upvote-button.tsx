/**
 * Upvote button with optimistic toggle.
 */

"use client";

import { useState, useCallback } from "react";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface UpvoteButtonProps {
  showcaseId: string;
  initialCount: number;
  initialUpvoted: boolean | null;
  isLoggedIn: boolean;
  onLoginRequired?: (() => void) | undefined;
  disabled?: boolean;
}

export function UpvoteButton({
  showcaseId,
  initialCount,
  initialUpvoted,
  isLoggedIn,
  onLoginRequired,
  disabled = false,
}: UpvoteButtonProps) {
  const [count, setCount] = useState(initialCount);
  const [upvoted, setUpvoted] = useState(initialUpvoted === true);
  const [loading, setLoading] = useState(false);

  const handleClick = useCallback(async () => {
    if (!isLoggedIn) {
      onLoginRequired?.();
      return;
    }

    if (loading || disabled) return;

    // Optimistic update
    const prevCount = count;
    const prevUpvoted = upvoted;
    setUpvoted(!upvoted);
    setCount(upvoted ? count - 1 : count + 1);
    setLoading(true);

    try {
      const res = await fetch(`/api/showcases/${showcaseId}/upvote`, {
        method: "POST",
      });

      if (!res.ok) {
        // Rollback on error
        setUpvoted(prevUpvoted);
        setCount(prevCount);
        return;
      }

      const data = (await res.json()) as { upvoted: boolean; upvote_count: number };
      // Sync with server state
      setUpvoted(data.upvoted);
      setCount(data.upvote_count);
    } catch {
      // Rollback on network error
      setUpvoted(prevUpvoted);
      setCount(prevCount);
    } finally {
      setLoading(false);
    }
  }, [showcaseId, count, upvoted, loading, disabled, isLoggedIn, onLoginRequired]);

  return (
    <button
      onClick={handleClick}
      disabled={loading || disabled}
      className={cn(
        "flex flex-col items-center justify-center gap-0.5 rounded-lg border px-3 py-2 min-w-[56px] transition-all",
        upvoted
          ? "border-primary bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
        (loading || disabled) && "opacity-50 cursor-not-allowed",
        !isLoggedIn && "hover:border-warning/50"
      )}
      title={!isLoggedIn ? "Login to upvote" : upvoted ? "Remove upvote" : "Upvote"}
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
    </button>
  );
}
