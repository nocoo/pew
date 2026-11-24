"use client";

import Link from "next/link";
import { Calendar, ArrowLeft, ShieldCheck } from "@nocoo/basalt/icons";
import { Banner } from "@nocoo/basalt/components/banner";
import { Button } from "@nocoo/basalt/components/button";
import { Empty } from "@nocoo/basalt/components/empty";
import { Github } from "@/components/icons/github";
import { chromeIconClassName } from "@/lib/ghost-icon";
import { useUserProfile } from "@/hooks/use-user-profile";
import { Skeleton } from "@nocoo/basalt/components/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@nocoo/basalt/components/avatar";
import { PageHeader } from "@/components/leaderboard/page-header";
import { HeaderTooltip, HexlyLink } from "@/components/layout/hexly-link";
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
      <HeaderTooltip label="Privacy policy">
        <Button variant="ghost" size="icon" className={chromeIconClassName} asChild>
          <Link href="/privacy" aria-label="Privacy policy">
            <ShieldCheck strokeWidth={1.5} aria-hidden="true" />
          </Link>
        </Button>
      </HeaderTooltip>
      <HeaderTooltip label="GitHub repository">
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
      </HeaderTooltip>
      <HexlyLink />
      <ThemeToggle />
    </div>
  );
}

function PewPageHeader() {
  return (
    <PageHeader>
      <h1 className="tracking-tight text-basalt-foreground">
        <span className="text-[36px] font-bold font-handwriting leading-none mr-2">pew</span>
        <span className="text-[19px] font-normal text-basalt-muted-foreground">Profile</span>
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
      <div className="relative flex min-h-screen flex-col bg-basalt-background">
        <TopRightIcons />
        <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col px-6">
          <PewPageHeader />
          <main className="flex-1 py-8">
            <div className="text-center space-y-4">
              <Empty title="404" description={`No public profile found for “${slug}”`} />
              <Link
                href="/leaderboard"
                className="inline-flex items-center gap-2 text-sm text-basalt-primary hover:underline"
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
      <div className="relative flex min-h-screen flex-col bg-basalt-background">
        <TopRightIcons />
        <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col px-6">
          <PewPageHeader />
          <main className="flex-1 py-8">
            <div className="text-center space-y-4">
              <Banner tone="danger" description={`Failed to load profile: ${error}`} />
              <Link
                href="/leaderboard"
                className="inline-flex items-center gap-2 text-sm text-basalt-primary hover:underline"
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
    <div className="relative flex min-h-screen flex-col bg-basalt-background">
      <TopRightIcons />

      <div className="mx-auto w-full max-w-6xl flex-1 flex flex-col px-6">
        <PewPageHeader />

        <main className="flex-1 py-4 space-y-4 md:space-y-6">
          {/* Profile header */}
          {loading && !user ? (
            <div className="flex items-center gap-4">
              <Skeleton style={{ width: undefined }} className="h-16 w-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton style={{ width: undefined }} className="h-6 w-40" />
                <Skeleton style={{ width: undefined }} className="h-4 w-24" />
              </div>
            </div>
          ) : (
            user && (
              <div className="flex items-center gap-4">
                <Avatar className="h-16 w-16">
                  {user.image && <AvatarImage src={user.image} alt={user.name ?? slug} />}
                  <AvatarFallback className="text-lg bg-basalt-primary text-basalt-primary-foreground">
                    {(user.name ?? slug)[0]?.toUpperCase() ?? "?"}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <h2 className="text-2xl font-bold font-display text-basalt-foreground">
                    {user.name ?? slug}
                  </h2>
                  <p className="flex items-center gap-1.5 text-sm text-basalt-muted-foreground">
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
