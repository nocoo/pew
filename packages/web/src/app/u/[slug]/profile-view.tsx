"use client";

import Link from "next/link";
import {
  Calendar,
  ArrowLeft,
  ShieldCheck,
} from "lucide-react";
import { Banner } from "@nocoo/basalt/components/banner";
import { Button } from "@nocoo/basalt/components/button";
import { Empty } from "@nocoo/basalt/components/empty";
import { Github } from "@/components/icons/github";
import { chromeIconClassName } from "@/components/ui/button";
import { useUserProfile } from "@/hooks/use-user-profile";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { BadgeIcon } from "@/components/badges/badge-icon";
import { PageHeader } from "@/components/leaderboard/page-header";
import { SiteFooter } from "@/components/layout/site-footer";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { formatMemberSince } from "@/lib/date-helpers";
import { ProfileContent } from "@/components/profile/profile-content";

// ---------------------------------------------------------------------------
// Page shell (top-right icons + header)
// ---------------------------------------------------------------------------

function TopRightIcons() {
  return (
    <div className="absolute right-6 top-4 z-50 flex items-center gap-1">
      <Button variant="ghost" size="icon" className={chromeIconClassName} asChild>
        <a href="/privacy" aria-label="Privacy policy">
          <ShieldCheck strokeWidth={1.5} aria-hidden="true" />
        </a>
      </Button>
      <Button variant="ghost" size="icon" className={chromeIconClassName} asChild>
        <a
          href="https://github.com/nocoo/pew"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View source on GitHub"
        >
          <Github strokeWidth={1.5} aria-hidden="true" />
        </a>
      </Button>
      <ThemeToggle />
    </div>
  );
}

function PewPageHeader() {
  return (
    <PageHeader>
      <h1 className="tracking-tight text-foreground">
        <span className="text-[36px] font-bold font-handwriting leading-none mr-2">
          pew
        </span>
        <span className="text-[19px] font-normal text-muted-foreground">
          Profile
        </span>
      </h1>
    </PageHeader>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface PublicProfileViewProps {
  slug: string;
}

export function PublicProfileView({ slug }: PublicProfileViewProps) {
  // Light fetch for user info + 404 detection
  const { user, loading, error, notFound } = useUserProfile({
    slug,
    days: 30,
  });

  // 404
  if (notFound) {
    return (
      <div className="relative flex min-h-screen flex-col bg-background">
        <TopRightIcons />
        <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col px-6">
          <PewPageHeader />
          <main className="flex-1 py-8">
            <div className="text-center space-y-4">
              <Empty
                title="404"
                description={`No public profile found for “${slug}”`}
              />
              <Link
                href="/leaderboard"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to leaderboard
              </Link>
            </div>
          </main>
        </div>
        <SiteFooter />
      </div>
    );
  }

  // Error
  if (error && !loading) {
    return (
      <div className="relative flex min-h-screen flex-col bg-background">
        <TopRightIcons />
        <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col px-6">
          <PewPageHeader />
          <main className="flex-1 py-8">
            <div className="text-center space-y-4">
              <Banner variant="error" description={`Failed to load profile: ${error}`} />
              <Link
                href="/leaderboard"
                className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
              >
                <ArrowLeft className="h-4 w-4" />
                Back to leaderboard
              </Link>
            </div>
          </main>
        </div>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <TopRightIcons />

      <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col px-6">
        <PewPageHeader />

        <main className="flex-1 py-4 space-y-4 md:space-y-6">
          {/* Profile header */}
          {loading && !user ? (
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          ) : (
            user && (
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  {user.image && (
                    <AvatarImage src={user.image} alt={user.name ?? slug} />
                  )}
                  <AvatarFallback className="text-lg bg-primary text-primary-foreground">
                    {(user.name ?? slug)[0]?.toUpperCase() ?? "?"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold font-display text-foreground">
                      {user.name ?? slug}
                    </h2>
                    {user.badges && user.badges.length > 0 && (
                      <div className="flex gap-1">
                        {user.badges.map((badge) => (
                          <BadgeIcon
                            key={`${badge.text}:${badge.icon}`}
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
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Calendar className="h-3.5 w-3.5" />
                    Member since {formatMemberSince(user.created_at)}
                  </p>
                </div>
              </div>
            )
          )}

          {/* Profile content — tabs + all data sections */}
          <ProfileContent slug={slug} defaultTab="7d" />
        </main>
      </div>

      <SiteFooter />
    </div>
  );
}
