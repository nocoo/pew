/**
 * Showcase card for list display (ProductHunt-style).
 */

"use client";

import Link from "next/link";
import { ExternalLink, Github, Star, GitFork, Code, Scale } from "lucide-react";
import { ShowcaseImage } from "./showcase-image";
import { UpvoteButton } from "./upvote-button";
import type { Showcase } from "@/hooks/use-showcases";

// Format large numbers (1000 -> 1k, 1000000 -> 1M)
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

interface ShowcaseCardProps {
  showcase: Showcase;
  isLoggedIn: boolean;
  onLoginRequired?: () => void;
}

export function ShowcaseCard({ showcase, isLoggedIn, onLoginRequired }: ShowcaseCardProps) {
  const displayName = showcase.user.nickname || showcase.user.name || "Anonymous";
  const githubOwner = showcase.repo_key.split("/")[0];

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

          {/* GitHub stats badges */}
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            {showcase.stars > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                <Star className="h-2.5 w-2.5" />
                {formatCount(showcase.stars)}
              </span>
            )}
            {showcase.forks > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                <GitFork className="h-2.5 w-2.5" />
                {formatCount(showcase.forks)}
              </span>
            )}
            {showcase.language && (
              <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">
                <Code className="h-2.5 w-2.5" />
                {showcase.language}
              </span>
            )}
            {showcase.license && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                <Scale className="h-2.5 w-2.5" />
                {showcase.license}
              </span>
            )}
          </div>
        </div>

        {/* Footer: Submitter + GitHub owner */}
        <div className="mt-2 flex items-center gap-3">
          {/* Pew user */}
          <div className="flex items-center gap-1.5">
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

          {/* GitHub owner */}
          <a
            href={`https://github.com/${githubOwner}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            title={`View ${githubOwner} on GitHub`}
          >
            <Github className="h-3.5 w-3.5" />
            <span className="truncate max-w-[100px]">{githubOwner}</span>
          </a>
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
