"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Users,
  ArrowLeft,
  Copy,
  Check,
  Trophy,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useSeasonRegistration,
  type AvailableSeason,
} from "@/hooks/use-season-registration";
import { formatSeasonDate } from "@/lib/seasons";
import type { SeasonStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamMember {
  userId: string;
  name: string | null;
  image: string | null;
  role: string;
  joinedAt: string;
}

interface TeamDetail {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  created_at: string;
  role: string;
  members: TeamMember[];
}

// ---------------------------------------------------------------------------
// CopyButton
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-success" strokeWidth={1.5} />
      ) : (
        <Copy className="h-3.5 w-3.5" strokeWidth={1.5} />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Status badge (reused from leaderboard)
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<SeasonStatus, string> = {
  active:
    "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/25",
  upcoming:
    "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/25",
  ended: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABELS: Record<SeasonStatus, string> = {
  active: "Active",
  upcoming: "Upcoming",
  ended: "Ended",
};

function StatusBadge({ status }: { status: SeasonStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_STYLES[status],
      )}
    >
      {status === "active" && (
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
      )}
      {STATUS_LABELS[status]}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Season registration row
// ---------------------------------------------------------------------------

function SeasonRow({
  season,
  onRegister,
  onWithdraw,
  busy,
}: {
  season: AvailableSeason;
  onRegister: (seasonId: string) => void;
  onWithdraw: (seasonId: string) => void;
  busy: string | null;
}) {
  const isBusy = busy === season.id;

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-accent/50 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-foreground truncate">
            {season.name}
          </p>
          <StatusBadge status={season.status} />
          {season.is_registered && (
            <span className="inline-flex items-center rounded-full bg-primary/15 text-primary border border-primary/25 px-2 py-0.5 text-xs font-medium">
              Registered
            </span>
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatSeasonDate(season.start_date)} – {formatSeasonDate(season.end_date)}
          {" · "}
          {season.team_count} team{season.team_count !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="shrink-0">
        {season.is_registered ? (
          // Can only withdraw from upcoming seasons
          season.status === "upcoming" ? (
            <button
              onClick={() => onWithdraw(season.id)}
              disabled={isBusy}
              className={cn(
                "rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors",
                isBusy && "opacity-50 cursor-not-allowed",
              )}
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                "Withdraw"
              )}
            </button>
          ) : null
        ) : season.status === "upcoming" ? (
          <button
            onClick={() => onRegister(season.id)}
            disabled={isBusy}
            className={cn(
              "rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
              isBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              "Register"
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season Registration Section
// ---------------------------------------------------------------------------

function SeasonRegistration({ teamId }: { teamId: string }) {
  const { seasons, loading, error, register, withdraw } =
    useSeasonRegistration({ teamId });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const handleRegister = async (seasonId: string) => {
    setBusyId(seasonId);
    setMessage(null);
    const ok = await register(seasonId);
    if (ok) {
      setMessage({ type: "success", text: "Team registered for season!" });
    } else {
      setMessage({ type: "error", text: error ?? "Registration failed" });
    }
    setBusyId(null);
  };

  const handleWithdraw = async (seasonId: string) => {
    setBusyId(seasonId);
    setMessage(null);
    const ok = await withdraw(seasonId);
    if (ok) {
      setMessage({ type: "success", text: "Withdrawn from season." });
    } else {
      setMessage({ type: "error", text: error ?? "Withdrawal failed" });
    }
    setBusyId(null);
  };

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {message && (
        <div
          className={cn(
            "rounded-lg p-3 text-xs",
            message.type === "success"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {message.text}
        </div>
      )}

      {seasons.length === 0 ? (
        <div className="rounded-lg bg-accent/50 p-4 text-center text-sm text-muted-foreground">
          No upcoming or active seasons available.
        </div>
      ) : (
        <div className="space-y-2">
          {seasons.map((season) => (
            <SeasonRow
              key={season.id}
              season={season}
              onRegister={handleRegister}
              onWithdraw={handleWithdraw}
              busy={busyId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Team Detail Page
// ---------------------------------------------------------------------------

export default function TeamDetailPage() {
  const params = useParams<{ teamId: string }>();
  const router = useRouter();
  const teamId = params.teamId;

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTeam = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/teams/${teamId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }
      const data = (await res.json()) as TeamDetail;
      setTeam(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load team");
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="max-w-3xl space-y-8">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error
  // -------------------------------------------------------------------------

  if (error || !team) {
    return (
      <div className="max-w-3xl space-y-8">
        <button
          onClick={() => router.push("/teams")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Back to Teams
        </button>
        <div className="rounded-xl bg-destructive/10 p-6 text-center text-sm text-destructive">
          {error ?? "Team not found"}
        </div>
      </div>
    );
  }

  const isOwner = team.role === "owner";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="max-w-3xl space-y-8">
      {/* Back link */}
      <button
        onClick={() => router.push("/teams")}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        Back to Teams
      </button>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-muted-foreground shrink-0">
            <Users className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-display">{team.name}</h1>
            <p className="text-sm text-muted-foreground">
              {team.members.length} member
              {team.members.length !== 1 ? "s" : ""}
              {isOwner && " · You are the owner"}
            </p>
          </div>
        </div>

        {/* Invite code */}
        <div className="mt-3 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Invite code:</span>
          <code className="rounded bg-accent px-2 py-0.5 text-xs font-mono text-muted-foreground">
            {team.invite_code}
          </code>
          <CopyButton text={team.invite_code} />
        </div>
      </div>

      {/* Members */}
      <section>
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
          <Users className="h-4 w-4" strokeWidth={1.5} />
          Members
        </h2>
        <div className="space-y-1.5">
          {team.members.map((member) => (
            <div
              key={member.userId}
              className="flex items-center gap-3 rounded-lg bg-secondary px-4 py-2.5"
            >
              <Avatar className="h-7 w-7">
                {member.image && <AvatarImage src={member.image} />}
                <AvatarFallback className="text-xs">
                  {(member.name ?? "?").charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">
                  {member.name ?? "Unknown"}
                </p>
              </div>
              <span
                className={cn(
                  "text-xs font-medium",
                  member.role === "owner"
                    ? "text-primary"
                    : "text-muted-foreground",
                )}
              >
                {member.role === "owner" ? "Owner" : "Member"}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Season registration — owners only */}
      {isOwner && (
        <section>
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
            <Trophy className="h-4 w-4" strokeWidth={1.5} />
            Season Registration
          </h2>
          <p className="text-xs text-muted-foreground mb-3">
            Register your team for upcoming seasons to compete on the
            leaderboard. Rosters are frozen at registration time.
          </p>
          <SeasonRegistration teamId={team.id} />
        </section>
      )}
    </div>
  );
}
