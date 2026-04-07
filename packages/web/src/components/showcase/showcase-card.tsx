/**
 * Showcase card for list display (ProductHunt-style).
 */

"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { ShowcaseImage } from "./showcase-image";
import { UpvoteButton } from "./upvote-button";
import type { Showcase } from "@/hooks/use-showcases";

interface ShowcaseCardProps {
  showcase: Showcase;
  isLoggedIn: boolean;
  onLoginRequired?: () => void;
}

export function ShowcaseCard({ showcase, isLoggedIn, onLoginRequired }: ShowcaseCardProps) {
  const displayName = showcase.user.nickname || showcase.user.name || "Anonymous";

  return (
    <article className="group relative flex gap-4 rounded-xl bg-secondary p-4 transition-all hover:bg-secondary/80">
      {/* OG Image */}
      <Link
        href={showcase.github_url}
        target="_blank"
        rel="noopener noreferrer"
        className="relative shrink-0 w-[180px] aspect-[1.91/1] rounded-lg overflow-hidden bg-accent/50"
      >
        <ShowcaseImage
          url={showcase.og_image_url}
          repoKey={showcase.repo_key}
          className="w-full h-full"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </Link>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div>
          {/* Title + External Link */}
          <div className="flex items-start gap-2">
            <Link
              href={showcase.github_url}
              target="_blank"
              rel="noopener noreferrer"
              className="group/title flex items-center gap-1.5"
            >
              <h3 className="text-base font-semibold text-foreground group-hover/title:text-primary transition-colors line-clamp-1">
                {showcase.title}
              </h3>
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0" />
            </Link>
          </div>

          {/* Tagline */}
          {showcase.tagline && (
            <p className="mt-0.5 text-sm text-primary/80 line-clamp-1">
              &ldquo;{showcase.tagline}&rdquo;
            </p>
          )}

          {/* Description */}
          {showcase.description && (
            <p className="mt-1.5 text-xs text-muted-foreground line-clamp-2">
              {showcase.description}
            </p>
          )}
        </div>

        {/* Footer: Submitter */}
        <div className="mt-2 flex items-center gap-2">
          {showcase.user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={showcase.user.image}
              alt={displayName}
              className="h-5 w-5 rounded-full"
            />
          ) : (
            <div className="h-5 w-5 rounded-full bg-accent flex items-center justify-center">
              <span className="text-[10px] font-medium text-muted-foreground">
                {displayName.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <span className="text-xs text-muted-foreground truncate">
            {displayName}
          </span>
        </div>
      </div>

      {/* Upvote Button */}
      <div className="shrink-0 self-center">
        <UpvoteButton
          showcaseId={showcase.id}
          initialCount={showcase.upvote_count}
          initialUpvoted={showcase.has_upvoted}
          isLoggedIn={isLoggedIn}
          onLoginRequired={onLoginRequired}
        />
      </div>
    </article>
  );
}
