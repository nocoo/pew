"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Github,
  Trophy,
  Medal,
  Award,
  EyeOff,
  ChevronDown,
  Globe,
  Users,
  ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTokens, formatTokensFull } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import {
  useLeaderboard,
  type LeaderboardPeriod,
  type LeaderboardEntry,
} from "@/hooks/use-leaderboard";
import { useAdmin } from "@/hooks/use-admin";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Team {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
}

/** Scope dropdown value: "global" | "all" (admin) | team id */
type ScopeValue = "global" | "all" | string;

// ---------------------------------------------------------------------------
// Period tabs
// ---------------------------------------------------------------------------

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "all", label: "All Time" },
];

// ---------------------------------------------------------------------------
// Team logo inline icon (with fallback)
// ---------------------------------------------------------------------------

function TeamLogoIcon({
  logoUrl,
  name,
  className,
}: {
  logoUrl: string | null;
  name: string;
  className?: string;
}) {
  const [error, setError] = useState(false);

  // Reset error state when logoUrl changes (e.g. switching selected team)
  useEffect(() => {
    setError(false);
  }, [logoUrl]);

  if (!logoUrl || error) {
    return <Users className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground", className)} strokeWidth={1.5} />;
  }
  return (
    <img
      src={logoUrl}
      alt={name}
      className={cn("h-3.5 w-3.5 shrink-0 rounded-sm object-cover", className)}
      onError={() => setError(true)}
    />
  );
}

/** Tiny inline logo for team badges in leaderboard rows */
function TeamLogoBadge({ logoUrl, name }: { logoUrl: string | null; name: string }) {
  const [error, setError] = useState(false);

  // Reset error state when logoUrl changes
  useEffect(() => {
    setError(false);
  }, [logoUrl]);

  if (!logoUrl || error) return null;
  return (
    <img
      src={logoUrl}
      alt={name}
      className="h-2.5 w-2.5 shrink-0 rounded-[2px] object-cover"
      onError={() => setError(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Scope dropdown (replaces team buttons + admin checkbox)
// ---------------------------------------------------------------------------

function ScopeDropdown({
  value,
  onChange,
  teams,
  isAdmin,
}: {
  value: ScopeValue;
  onChange: (v: ScopeValue) => void;
  teams: Team[];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const iconClass = "h-3.5 w-3.5 shrink-0 text-muted-foreground";

  const label =
    value === "global"
      ? "Global"
      : value === "all"
        ? "All Users"
        : teams.find((t) => t.id === value)?.name ?? "Global";

  const selectedTeam = teams.find((t) => t.id === value);

  const labelIcon =
    value === "global" ? (
      <Globe className={iconClass} strokeWidth={1.5} />
    ) : value === "all" ? (
      <ShieldCheck className={iconClass} strokeWidth={1.5} />
    ) : selectedTeam ? (
      <TeamLogoIcon logoUrl={selectedTeam.logo_url} name={selectedTeam.name} />
    ) : (
      <Users className={iconClass} strokeWidth={1.5} />
    );

  // Only show dropdown if there are teams or user is admin
  if (teams.length === 0 && !isAdmin) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={cn(
          "flex items-center gap-2 rounded-lg bg-secondary px-3 py-[10px] text-sm font-medium transition-colors",
          "text-foreground hover:bg-accent",
        )}
      >
        {labelIcon}
        {label}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
          strokeWidth={1.5}
        />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-background p-1 shadow-lg">
          <DropdownItem
            active={value === "global"}
            onClick={() => {
              onChange("global");
              setOpen(false);
            }}
          >
            <Globe className={iconClass} strokeWidth={1.5} />
            Global
          </DropdownItem>
          {teams.map((team) => (
            <DropdownItem
              key={team.id}
              active={value === team.id}
              onClick={() => {
                onChange(team.id);
                setOpen(false);
              }}
            >
              <TeamLogoIcon logoUrl={team.logo_url} name={team.name} />
              {team.name}
            </DropdownItem>
          ))}
          {isAdmin && (
            <>
              <div className="mx-2 my-1 border-t border-border" />
              <DropdownItem
                active={value === "all"}
                onClick={() => {
                  onChange("all");
                  setOpen(false);
                }}
              >
                <ShieldCheck className={iconClass} strokeWidth={1.5} />
                All Users
                <span className="ml-auto text-[10px] text-muted-foreground">
                  admin
                </span>
              </DropdownItem>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DropdownItem({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Rank decorations
// ---------------------------------------------------------------------------

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return <Trophy className="h-5 w-5 text-yellow-500" strokeWidth={1.5} />;
  }
  if (rank === 2) {
    return <Medal className="h-5 w-5 text-gray-400" strokeWidth={1.5} />;
  }
  if (rank === 3) {
    return <Award className="h-5 w-5 text-amber-600" strokeWidth={1.5} />;
  }
  return (
    <span className="flex h-5 w-5 items-center justify-center text-xs font-medium text-muted-foreground">
      {rank}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Check-style ruling lines (right-side texture)
// ---------------------------------------------------------------------------

function CheckRuling() {
  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 w-1/3 opacity-[0.04]"
      aria-hidden="true"
    >
      {/* Horizontal ruling lines */}
      <div className="absolute inset-0 flex flex-col justify-evenly">
        <div className="h-px bg-foreground" />
        <div className="h-px bg-foreground" />
        <div className="h-px bg-foreground" />
        <div className="h-px bg-foreground" />
        <div className="h-px bg-foreground" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row component — check-style design
// ---------------------------------------------------------------------------

function LeaderboardRow({
  entry,
  showHiddenBadge,
  index,
}: {
  entry: LeaderboardEntry;
  showHiddenBadge?: boolean;
  index: number;
}) {
  const { rank, user, teams, total_tokens, input_tokens, output_tokens } =
    entry;
  const displayName = user.name ?? "Anonymous";
  const initial = displayName[0]?.toUpperCase() ?? "?";

  const content = (
    <div
      className={cn(
        "relative flex items-center gap-4 overflow-hidden rounded-[var(--radius-card)] bg-secondary px-4 py-4 transition-colors animate-fade-up",
        user.slug && "hover:bg-accent cursor-pointer",
        rank <= 3 && "ring-1 ring-border/50",
      )}
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Check ruling texture */}
      <CheckRuling />

      {/* Rank */}
      <div className="flex w-8 shrink-0 items-center justify-center">
        <RankBadge rank={rank} />
      </div>

      {/* Avatar + Name + Teams */}
      <div className="flex flex-1 items-center gap-3 min-w-0">
        <Avatar className="h-8 w-8 shrink-0">
          {user.image && <AvatarImage src={user.image} alt={displayName} />}
          <AvatarFallback className="text-xs bg-primary text-primary-foreground">
            {initial}
          </AvatarFallback>
        </Avatar>
        <div className="flex flex-col min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground truncate">
              {displayName}
            </span>
            {showHiddenBadge && user.is_public === false && (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                <EyeOff className="h-3 w-3" strokeWidth={1.5} />
                hidden
              </span>
            )}
          </div>
          {teams.length > 0 && (
            <div className="flex gap-1 flex-wrap">
              {teams.map((team) => (
                <span
                  key={team.id}
                  className="inline-flex items-center gap-1 text-[10px] leading-tight text-muted-foreground bg-muted px-1.5 py-0.5 rounded"
                >
                  <TeamLogoBadge logoUrl={team.logo_url} name={team.name} />
                  {team.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Token breakdown (hidden on mobile) */}
      <div className="hidden sm:flex items-center gap-6 text-xs text-muted-foreground">
        <span title="Input tokens">{formatTokens(input_tokens)} in</span>
        <span title="Output tokens">{formatTokens(output_tokens)} out</span>
      </div>

      {/* Total — check-style handwriting font, full number */}
      <div className="relative z-10 shrink-0 text-right">
        <span className="font-handwriting text-3xl leading-none tracking-tight text-foreground">
          {formatTokensFull(total_tokens)}
        </span>
      </div>
    </div>
  );

  if (user.slug) {
    return <Link href={`/u/${user.slug}`}>{content}</Link>;
  }
  return content;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function LeaderboardSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 10 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-[var(--radius-card)] bg-secondary px-4 py-4"
        >
          <Skeleton className="h-5 w-8" />
          <Skeleton className="h-8 w-8 rounded-full" />
          <Skeleton className="h-4 w-32" />
          <div className="flex-1" />
          <Skeleton className="h-6 w-28" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [scope, setScope] = useState<ScopeValue>("global");
  const [teams, setTeams] = useState<Team[]>([]);
  const { isAdmin } = useAdmin();

  // Derive hook params from scope
  const teamId = scope !== "global" && scope !== "all" ? scope : null;
  const admin = scope === "all";

  const { data, loading, refreshing, error } = useLeaderboard({
    period,
    teamId,
    admin,
  });

  // Fetch user's teams for the filter dropdown (only works if logged in)
  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch("/api/teams");
      if (res.ok) {
        const json = await res.json();
        setTeams(json.teams ?? []);
      }
    } catch {
      // Silently fail — teams are optional, viewer may not be logged in
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  const showHiddenBadge = scope === "all";

  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      {/* Top-right icons — same pattern as landing page */}
      <div className="absolute right-6 top-4 z-50 flex items-center gap-1">
        <a
          href="https://github.com/nicnocquee/pew"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-[color] duration-200 hover:text-foreground"
          aria-label="View source on GitHub"
        >
          <Github className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        </a>
        <ThemeToggle />
      </div>

      {/* Header */}
      <header className="mx-auto w-full max-w-3xl px-6 pt-10 pb-2">
        <div
          className="flex items-center gap-5 animate-fade-up"
          style={{ animationDelay: "0ms" }}
        >
          <Link
            href="/"
            className="shrink-0 hover:opacity-80 transition-opacity"
          >
            <Image
              src="/logo-80.png"
              alt="Pew"
              width={48}
              height={48}
            />
          </Link>
          <div className="flex flex-col">
            <h1 className="text-2xl font-bold font-display tracking-tight text-foreground">
              pew{" "}
              <span className="font-normal text-muted-foreground">
                Leaderboard
              </span>
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Who&apos;s burning the most tokens?
            </p>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-4 space-y-4">
        {/* Controls row */}
        <div
          className="flex items-center gap-3 animate-fade-up"
          style={{ animationDelay: "180ms" }}
        >
          {/* Period tabs */}
          <div className="flex gap-1 rounded-lg bg-secondary p-1 flex-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  period === p.value
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Scope dropdown (teams + admin show-all) */}
          <ScopeDropdown
            value={scope}
            onChange={setScope}
            teams={teams}
            isAdmin={isAdmin}
          />
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-[var(--radius-card)] bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load leaderboard: {error}
          </div>
        )}

        {/* Loading — skeleton only on initial load */}
        {loading && !data && <LeaderboardSkeleton />}

        {/* Content — stays visible during refreshing with opacity transition */}
        {data && (
          <div
            className={cn(
              "space-y-2 transition-opacity duration-200",
              refreshing && "opacity-60",
            )}
          >
            {data.entries.length === 0 ? (
              <div className="rounded-[var(--radius-card)] bg-secondary p-8 text-center text-sm text-muted-foreground">
                No usage data for this period yet.
              </div>
            ) : (
              data.entries.map((entry, i) => (
                <LeaderboardRow
                  key={entry.rank}
                  entry={entry}
                  showHiddenBadge={showHiddenBadge}
                  index={i}
                />
              ))
            )}
          </div>
        )}
      </main>

      {/* Footer — same pattern as landing page */}
      <footer className="px-6 py-3">
        <p className="text-center text-xs text-muted-foreground">
          Powered by{" "}
          <Link href="/" className="text-primary hover:underline">
            pew
          </Link>{" "}
          &mdash; AI token usage tracker
        </p>
      </footer>
    </div>
  );
}
