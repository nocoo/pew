/**
 * Showcase OG image with gradient fallback on error.
 */

"use client";

import { useState } from "react";

interface ShowcaseImageProps {
  url: string | null;
  repoKey: string;
  className?: string;
}

export function ShowcaseImage({ url, repoKey, className = "" }: ShowcaseImageProps) {
  const [error, setError] = useState(false);

  if (!url || error) {
    return (
      <div
        className={`bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center ${className}`}
      >
        <span className="text-muted-foreground text-sm font-mono truncate px-2">
          {repoKey}
        </span>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={repoKey}
      className={`object-cover ${className}`}
      onError={() => setError(true)}
      loading="lazy"
    />
  );
}
