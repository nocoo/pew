"use client";

import { useMemo } from "react";
import { Dialog } from "radix-ui";
import { X, Calendar } from "lucide-react";
import { formatMemberSince } from "@/lib/date-helpers";
import { useAdmin } from "@/hooks/use-admin";
import { useSeasons } from "@/hooks/use-seasons";
import { useUserProfile } from "@/hooks/use-user-profile";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { BadgeIcon } from "@/components/badges/badge-icon";
import {
  ProfileContent,
  type ProfileTab,
} from "@/components/profile/profile-content";
import type { LeaderboardBadge } from "@/hooks/use-leaderboard";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Re-export for backward compat with existing consumers */
export type ProfileDialogTab = ProfileTab;

/** Resolved season info used internally */
interface ResolvedSeason {
  name: string;
  start: string;
  end: string;
}

export interface UserProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** User slug (or user ID as fallback) for fetching profile data */
  slug: string | null;
  /** Display name (shown while loading) */
  name?: string | null;
  /** Avatar image URL (shown while loading) */
  image?: string | null;
  /** Active badges for this user (from leaderboard entry) */
  badges?: LeaderboardBadge[];
  /** Which tab to select initially (default: "7d") */
  defaultTab?: ProfileDialogTab;
  /** Pre-fetched season name (from season leaderboard entry point) */
  seasonName?: string;
  /** Pre-fetched season start date ISO 8601 (from season leaderboard entry point) */
  seasonStart?: string;
  /** Pre-fetched season end date ISO 8601 — exclusive (from season leaderboard entry point) */
  seasonEnd?: string;
}

// ---------------------------------------------------------------------------
// Config loading skeleton — shown while admin + season resolve
// ---------------------------------------------------------------------------

function ConfigLoadingSkeleton({
  name,
  image,
}: {
  name?: string | null | undefined;
  image?: string | null | undefined;
}) {
  const displayName = name ?? "User";
  const displayImage = image;
  const initial = displayName[0]?.toUpperCase() ?? "?";

  return (
    <>
      {/* Header — shows known info while config resolves */}
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-4">
          <Avatar className="h-14 w-14">
            {displayImage && (
              <AvatarImage src={displayImage} alt={displayName} />
            )}
            <AvatarFallback className="bg-primary text-primary-foreground text-lg">
              {initial}
            </AvatarFallback>
          </Avatar>
          <div>
            <Dialog.Title className="text-xl font-semibold text-foreground">
              {displayName}
            </Dialog.Title>
            <Skeleton className="h-4 w-32 mt-1" />
          </div>
        </div>
        <Dialog.Close asChild>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </Dialog.Close>
      </div>

      {/* Tab bar skeleton */}
      <div className="flex gap-1 rounded-lg bg-secondary p-1 mb-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex-1 rounded-md px-3 py-2">
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 space-y-2"
            >
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-3">
          <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5">
            <Skeleton className="h-4 w-24 mb-3" />
            <Skeleton className="h-[220px] w-full" />
          </div>
          <div className="rounded-[var(--radius-card)] bg-secondary p-4 md:p-5 flex flex-col">
            <Skeleton className="h-4 w-20 mb-3" />
            <div className="flex flex-1 items-center justify-center">
              <Skeleton className="h-[180px] w-[180px] rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Dialog header — remounted via key to reset when slug changes
// ---------------------------------------------------------------------------

interface DialogHeaderProps {
  slug: string | null;
  name?: string | null | undefined;
  image?: string | null | undefined;
  badges?: LeaderboardBadge[];
  isAdmin: boolean;
}

function DialogHeader({ slug, name, image, badges: badgesProp, isAdmin }: DialogHeaderProps) {
  // Light fetch just for user info (name, avatar, member since, badges)
  const { user, loading } = useUserProfile({ slug: slug ?? "", days: 7 });

  const displayName = user?.name ?? name ?? "User";
  const displayImage = user?.image ?? image;
  const initial = displayName[0]?.toUpperCase() ?? "?";
  const isFirstLoad = loading && !user;

  // Prefer fresh badges from uncached profile fetch, fall back to cached prop
  const displayBadges = user?.badges ?? badgesProp ?? [];

  return (
    <div className="flex items-start justify-between mb-5">
      <div className="flex items-center gap-4">
        <Avatar className="h-14 w-14">
          {displayImage && (
            <AvatarImage src={displayImage} alt={displayName} />
          )}
          <AvatarFallback className="bg-primary text-primary-foreground text-lg">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div>
          <div className="flex items-center gap-2">
            <Dialog.Title className="text-xl font-semibold text-foreground">
              {isFirstLoad && !user ? (
                <Skeleton className="h-6 w-40" />
              ) : (
                displayName
              )}
            </Dialog.Title>
            {displayBadges.length > 0 && (
              <div className="flex gap-1">
                {displayBadges.map((badge, idx) => (
                  <BadgeIcon
                    key={idx}
                    text={badge.text}
                    icon={badge.icon}
                    colorBg={badge.colorBg}
                    colorText={badge.colorText}
                    size="sm"
                  />
                ))}
              </div>
            )}
          </div>
          {user && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground mt-0.5">
              <Calendar className="h-3.5 w-3.5" />
              Member since {formatMemberSince(user.created_at)}
              {isAdmin && user.first_seen && (
                <span className="text-muted-foreground/60">
                  · Data since {formatMemberSince(user.first_seen)}
                </span>
              )}
            </p>
          )}
        </div>
      </div>
      <Dialog.Close asChild>
        <button
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </Dialog.Close>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function UserProfileDialog({
  open,
  onOpenChange,
  slug,
  name,
  image,
  badges,
  defaultTab = "7d",
  seasonName,
  seasonStart,
  seasonEnd,
}: UserProfileDialogProps) {
  // Resolve admin status
  const { isAdmin, loading: adminLoading } = useAdmin();

  // Fetch active season (always fires; result ignored when season props exist)
  const { data: seasonsData, loading: seasonsLoading } = useSeasons({
    status: "active",
  });

  // Season from props (season leaderboard entry point)
  const seasonFromProps = useMemo<ResolvedSeason | null>(() => {
    if (seasonName && seasonStart && seasonEnd) {
      return { name: seasonName, start: seasonStart, end: seasonEnd };
    }
    return null;
  }, [seasonName, seasonStart, seasonEnd]);

  // Season from API (other entry points)
  const seasonFromAPI = useMemo<ResolvedSeason | null>(() => {
    const active = seasonsData?.seasons?.[0];
    if (!active) return null;
    // Compute exclusive end date (end_date is inclusive at minute precision)
    const exclusiveEnd = new Date(
      new Date(active.end_date).getTime() + 60_000,
    ).toISOString();
    return { name: active.name, start: active.start_date, end: exclusiveEnd };
  }, [seasonsData]);

  // Resolved season: props take precedence
  const season = seasonFromProps ?? seasonFromAPI;

  // Config is ready when admin check is done AND season is resolved
  // (season from props = instant, season from API = wait for fetch)
  const configReady =
    !adminLoading && (seasonFromProps !== null || !seasonsLoading);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-6xl max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-card p-6 md:p-8 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          {configReady ? (
            <>
              <DialogHeader
                key={`header-${slug}`}
                slug={slug}
                name={name}
                image={image}
                {...(badges && badges.length > 0 && { badges })}
                isAdmin={isAdmin}
              />
              <ProfileContent
                key={`content-${slug}-${defaultTab}`}
                slug={slug ?? ""}
                defaultTab={defaultTab}
                season={season ?? undefined}
                showAdminTabs={isAdmin}
              />
            </>
          ) : (
            <ConfigLoadingSkeleton name={name} image={image} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
