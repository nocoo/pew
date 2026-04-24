"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Camera,
  Users,
  X,
  Check,
  ChevronUp,
  RefreshCw,
  Circle,
  Clock,
  CheckCircle2,
  UserPlus,
  ArrowLeftRight,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import { formatSeasonDate } from "@/lib/seasons";
import { utcToLocalDatetimeValue, localDatetimeValueToUtc } from "@/lib/date-helpers";
import type { SeasonStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SeasonRow {
  id: string;
  name: string;
  slug: string;
  start_date: string;
  end_date: string;
  status: SeasonStatus;
  team_count: number;
  created_at: string;
  allow_late_registration: boolean;
  allow_roster_changes: boolean;
  allow_late_withdrawal: boolean;
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function SeasonsSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-secondary p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-16" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge + rules display
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  SeasonStatus,
  { icon: typeof Circle; color: string; bg: string; dot: string }
> = {
  active: {
    icon: Circle,
    color: "text-success",
    bg: "bg-success/15",
    dot: "bg-success",
  },
  upcoming: {
    icon: Clock,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-500/15",
    dot: "bg-blue-500",
  },
  ended: {
    icon: CheckCircle2,
    color: "text-muted-foreground",
    bg: "bg-muted",
    dot: "bg-muted-foreground",
  },
};

function StatusBadge({ status }: { status: SeasonStatus }) {
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold leading-none tracking-wide uppercase",
        config.bg,
        config.color,
      )}
    >
      {status === "active" ? (
        <span className="relative flex h-2 w-2">
          <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-75", config.dot)} />
          <span className={cn("relative inline-flex h-2 w-2 rounded-full", config.dot)} />
        </span>
      ) : (
        <Icon className="h-3 w-3" strokeWidth={2} />
      )}
      {status}
    </span>
  );
}

const RULE_CONFIG = [
  {
    key: "allow_late_registration" as const,
    label: "Late Registration",
    shortLabel: "Registration",
    icon: UserPlus,
  },
  {
    key: "allow_roster_changes" as const,
    label: "Roster Changes",
    shortLabel: "Roster",
    icon: ArrowLeftRight,
  },
  {
    key: "allow_late_withdrawal" as const,
    label: "Late Withdrawal",
    shortLabel: "Withdrawal",
    icon: LogOut,
  },
];

function SeasonRules({ season }: { season: SeasonRow }) {
  const activeRules = RULE_CONFIG.filter((r) => season[r.key]);
  if (activeRules.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {activeRules.map((rule) => {
        const Icon = rule.icon;
        return (
          <span
            key={rule.key}
            title={rule.label}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-border"
          >
            <Icon className="h-2.5 w-2.5" strokeWidth={1.5} />
            {rule.shortLabel}
          </span>
        );
      })}
    </div>
  );
}

/** Season time progress bar — only shown for active seasons. */
function SeasonProgress({ season }: { season: SeasonRow }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (season.status !== "active") return;
    // Update once per minute for a smooth progress bar
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [season.status]);

  if (season.status !== "active") return null;
  const start = new Date(season.start_date).getTime();
  const end = new Date(season.end_date).getTime();
  const total = end - start;
  if (total <= 0) return null;
  const elapsed = Math.max(0, Math.min(now - start, total));
  const pct = Math.round((elapsed / total) * 100);
  const remaining = end - now;
  const daysLeft = Math.max(0, Math.ceil(remaining / 86_400_000));

  return (
    <div className="mt-2 space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
        <span>{pct}% elapsed</span>
        <span>
          {daysLeft}d left
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-border/60 overflow-hidden">
        <div
          className="h-full rounded-full bg-success transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

function CreateSeasonForm({
  onCreated,
  onCancel,
}: {
  onCreated: (msg: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [allowLateRegistration, setAllowLateRegistration] = useState(false);
  const [allowRosterChanges, setAllowRosterChanges] = useState(false);
  const [allowLateWithdrawal, setAllowLateWithdrawal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-generate slug from name
  const handleNameChange = (v: string) => {
    setName(v);
    if (!slug || slug === autoSlug(name)) {
      setSlug(autoSlug(v));
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/seasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          slug: slug.trim(),
          start_date: startDate ? localDatetimeValueToUtc(startDate) : "",
          end_date: endDate ? localDatetimeValueToUtc(endDate) : "",
          allow_late_registration: allowLateRegistration,
          allow_roster_changes: allowRosterChanges,
          allow_late_withdrawal: allowLateWithdrawal,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { name: string };
      onCreated(`Season "${data.name}" created.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl bg-secondary p-4">
      <h3 className="text-sm font-medium text-foreground mb-3">
        Create Season
      </h3>
      {error && (
        <div className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive mb-3">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Season 1"
            maxLength={64}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Slug
          </label>
          <input
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="season-1"
            maxLength={32}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Start Date
          </label>
          <input
            type="datetime-local"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            End Date
          </label>
          <input
            type="datetime-local"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
          />
        </div>
      </div>
      <div className="mt-3">
        <label className="block text-xs font-medium text-muted-foreground mb-2">
          Rules
        </label>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={allowLateRegistration}
              onChange={(e) => setAllowLateRegistration(e.target.checked)}
              className="rounded border-border"
            />
            Allow late registration
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={allowRosterChanges}
              onChange={(e) => setAllowRosterChanges(e.target.checked)}
              className="rounded border-border"
            />
            Allow roster changes
          </label>
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={allowLateWithdrawal}
              onChange={(e) => setAllowLateWithdrawal(e.target.checked)}
              className="rounded border-border"
            />
            Allow late withdrawal
          </label>
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4">
        <button
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || !slug.trim() || !startDate || !endDate}
          className={cn(
            "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
            (submitting || !name.trim() || !slug.trim() || !startDate || !endDate) &&
              "opacity-50 cursor-not-allowed",
          )}
        >
          {submitting ? "Creating..." : "Create"}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit form (inline expandable)
// ---------------------------------------------------------------------------

function EditSeasonRow({
  season,
  onSaved,
  onCancel,
}: {
  season: SeasonRow;
  onSaved: (msg: string) => void;
  onCancel: () => void;
}) {
  const isUpcoming = season.status === "upcoming";
  const [name, setName] = useState(season.name);
  // Convert UTC ISO datetime to local datetime-local value for the input
  const [startDate, setStartDate] = useState(
    utcToLocalDatetimeValue(season.start_date)
  );
  const [endDate, setEndDate] = useState(
    utcToLocalDatetimeValue(season.end_date)
  );
  const [allowLateRegistration, setAllowLateRegistration] = useState(season.allow_late_registration);
  const [allowRosterChanges, setAllowRosterChanges] = useState(season.allow_roster_changes);
  const [allowLateWithdrawal, setAllowLateWithdrawal] = useState(season.allow_late_withdrawal);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, string | boolean> = {};
      if (name.trim() !== season.name) payload.name = name.trim();
      if (isUpcoming && localDatetimeValueToUtc(startDate) !== season.start_date)
        payload.start_date = localDatetimeValueToUtc(startDate);
      if (isUpcoming && localDatetimeValueToUtc(endDate) !== season.end_date)
        payload.end_date = localDatetimeValueToUtc(endDate);
      if (allowLateRegistration !== season.allow_late_registration)
        payload.allow_late_registration = allowLateRegistration;
      if (allowRosterChanges !== season.allow_roster_changes)
        payload.allow_roster_changes = allowRosterChanges;
      if (allowLateWithdrawal !== season.allow_late_withdrawal)
        payload.allow_late_withdrawal = allowLateWithdrawal;

      if (Object.keys(payload).length === 0) {
        onCancel();
        return;
      }

      const res = await fetch(`/api/admin/seasons/${season.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onSaved(`Season "${name.trim()}" updated.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <tr className="border-b border-border/50">
      <td colSpan={6} className="px-4 py-3">
        {error && (
          <div className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive mb-2">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Slug (read-only)
            </label>
            <input
              type="text"
              value={season.slug}
              disabled
              className="w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground font-mono cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Start Date{!isUpcoming && " (locked)"}
            </label>
            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!isUpcoming}
              className={cn(
                "w-full rounded-lg border border-border px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow",
                isUpcoming
                  ? "bg-background text-foreground"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              End Date{!isUpcoming && " (locked)"}
            </label>
            <input
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!isUpcoming}
              className={cn(
                "w-full rounded-lg border border-border px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow",
                isUpcoming
                  ? "bg-background text-foreground"
                  : "bg-muted text-muted-foreground cursor-not-allowed",
              )}
            />
          </div>
        </div>
        <div className="mt-3">
          <label className="block text-xs font-medium text-muted-foreground mb-2">
            Rules
          </label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={allowLateRegistration}
                onChange={(e) => setAllowLateRegistration(e.target.checked)}
                className="rounded border-border"
              />
              Allow late registration
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={allowRosterChanges}
                onChange={(e) => setAllowRosterChanges(e.target.checked)}
                className="rounded border-border"
              />
              Allow roster changes
            </label>
            <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={allowLateWithdrawal}
                onChange={(e) => setAllowLateWithdrawal(e.target.checked)}
                className="rounded border-border"
              />
              Allow late withdrawal
            </label>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={handleSave}
            disabled={submitting || !name.trim()}
            className={cn(
              "flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
              (submitting || !name.trim()) && "opacity-50 cursor-not-allowed",
            )}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
            {submitting ? "Saving..." : "Save"}
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            Cancel
          </button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function autoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminSeasonsPage() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();

  const [rows, setRows] = useState<SeasonRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Create form toggle
  const [showCreate, setShowCreate] = useState(false);

  // Editing state
  const [editingId, setEditingId] = useState<string | null>(null);

  // Expanded team view
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedTeams, setExpandedTeams] = useState<
    { team_id: string; team_name: string; registered_at: string }[]
  >([]);
  const [expandedLoading, setExpandedLoading] = useState(false);

  // Snapshot generating
  const [snapshotting, setSnapshotting] = useState<string | null>(null);

  // Roster syncing
  const [syncing, setSyncing] = useState<string | null>(null);
  const { confirm, dialogProps } = useConfirm();

  // ---------------------------------------------------------------------------
  // Redirect non-admins
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/");
    }
  }, [adminLoading, isAdmin, router]);

  // ---------------------------------------------------------------------------
  // Fetch rows
  // ---------------------------------------------------------------------------

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/seasons");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as { seasons: SeasonRow[] };
      setRows(json.seasons);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: setState before/after fetch is the standard React pattern
    if (isAdmin) fetchRows();
  }, [isAdmin, fetchRows]);

  // ---------------------------------------------------------------------------
  // Fetch registered teams for a season
  // ---------------------------------------------------------------------------

  const fetchTeams = useCallback(
    async (seasonId: string) => {
      if (expandedId === seasonId) {
        setExpandedId(null);
        setExpandedTeams([]);
        return;
      }

      setExpandedId(seasonId);
      setExpandedLoading(true);
      setExpandedTeams([]);

      try {
        // Use leaderboard API to get teams (it includes team names)
        const res = await fetch(
          `/api/seasons/${seasonId}/leaderboard`,
        );
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          entries: { team: { id: string; name: string }; total_tokens: number }[];
        };
        setExpandedTeams(
          json.entries.map((e) => ({
            team_id: e.team.id,
            team_name: e.team.name,
            registered_at: "",
          })),
        );
      } catch {
        setExpandedTeams([]);
      } finally {
        setExpandedLoading(false);
      }
    },
    [expandedId],
  );

  // ---------------------------------------------------------------------------
  // Generate snapshot
  // ---------------------------------------------------------------------------

  const handleSnapshot = async (season: SeasonRow) => {
    const confirmed = await confirm({
      title: "Generate final snapshot?",
      description: `This will freeze rankings for "${season.name}". Once generated, rankings cannot be changed.`,
      confirmText: "Generate Snapshot",
    });
    if (!confirmed) return;

    setSnapshotting(season.id);
    setMessage(null);

    try {
      const res = await fetch(
        `/api/admin/seasons/${season.id}/snapshot`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        team_count: number;
        member_count: number;
      };
      setMessage({
        type: "success",
        text: `Snapshot created: ${json.team_count} teams, ${json.member_count} members.`,
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to create snapshot.",
      });
    } finally {
      setSnapshotting(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Sync rosters
  // ---------------------------------------------------------------------------

  const handleSyncRosters = async (season: SeasonRow) => {
    setSyncing(season.id);
    setMessage(null);

    try {
      const res = await fetch(
        `/api/admin/seasons/${season.id}/sync-rosters`,
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { synced_teams: number };
      setMessage({
        type: "success",
        text: `Rosters synced for ${json.synced_teams} team${json.synced_teams === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to sync rosters.",
      });
    } finally {
      setSyncing(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Guard: loading or not admin
  // ---------------------------------------------------------------------------

  if (adminLoading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80 mt-2" />
        </div>
        <SeasonsSkeleton />
      </div>
    );
  }

  if (!isAdmin) return null;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Seasons</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage competition seasons. Teams register and compete on token
            usage.
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setEditingId(null);
          }}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Create Season
        </button>
      </div>

      {/* Messages */}
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

      {/* Error */}
      {error && (
        <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load seasons: {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <CreateSeasonForm
          onCreated={(msg) => {
            setShowCreate(false);
            setMessage({ type: "success", text: msg });
            fetchRows();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Loading */}
      {loading && <SeasonsSkeleton />}

      {/* Table */}
      {!loading && (
        <>
          {rows.length === 0 ? (
            <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
              No seasons yet. Create one to get started.
            </div>
          ) : (
            <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Slug
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                      Dates
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground hidden md:table-cell">
                      Teams
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-32">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    editingId === row.id ? (
                      <EditSeasonRow
                        key={row.id}
                        season={row}
                        onSaved={(msg) => {
                          setEditingId(null);
                          setMessage({ type: "success", text: msg });
                          fetchRows();
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <SeasonTableRow
                        key={row.id}
                        row={row}
                        expandedId={expandedId}
                        expandedTeams={expandedTeams}
                        expandedLoading={expandedLoading}
                        snapshotting={snapshotting}
                        syncing={syncing}
                        onEdit={() => {
                          setEditingId(row.id);
                          setShowCreate(false);
                        }}
                        onToggleTeams={() => fetchTeams(row.id)}
                        onSnapshot={() => handleSnapshot(row)}
                        onSyncRosters={() => handleSyncRosters(row)}
                      />
                    )
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Season table row (extracted to avoid inline complexity)
// ---------------------------------------------------------------------------

function SeasonTableRow({
  row,
  expandedId,
  expandedTeams,
  expandedLoading,
  snapshotting,
  syncing,
  onEdit,
  onToggleTeams,
  onSnapshot,
  onSyncRosters,
}: {
  row: SeasonRow;
  expandedId: string | null;
  expandedTeams: { team_id: string; team_name: string; registered_at: string }[];
  expandedLoading: boolean;
  snapshotting: string | null;
  syncing: string | null;
  onEdit: () => void;
  onToggleTeams: () => void;
  onSnapshot: () => void;
  onSyncRosters: () => void;
}) {
  const isExpanded = expandedId === row.id;

  return (
    <>
      <tr className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors">
        <td className="px-4 py-3">
          <span className="text-sm font-medium text-foreground">
            {row.name}
          </span>
        </td>
        <td className="px-4 py-3">
          <span className="text-sm font-mono text-muted-foreground">
            {row.slug}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex flex-col">
            <StatusBadge status={row.status} />
            <SeasonRules season={row} />
            <SeasonProgress season={row} />
          </div>
        </td>
        <td className="px-4 py-3 hidden sm:table-cell">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatSeasonDate(row.start_date)} &mdash; {formatSeasonDate(row.end_date)}
          </span>
        </td>
        <td className="px-4 py-3 text-center hidden md:table-cell">
          <span className="text-sm tabular-nums text-muted-foreground">
            {row.team_count}
          </span>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1">
            {/* Edit */}
            <button
              onClick={onEdit}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Edit season"
            >
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>

            {/* View teams */}
            {row.team_count > 0 && (
              <button
                onClick={onToggleTeams}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                title="View registered teams"
              >
                {isExpanded ? (
                  <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.5} />
                ) : (
                  <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
                )}
              </button>
            )}

            {/* Sync rosters */}
            {row.status === "active" && row.allow_roster_changes && (
              <button
                onClick={onSyncRosters}
                disabled={syncing === row.id}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
                  syncing === row.id && "opacity-50 cursor-not-allowed",
                )}
                title="Sync rosters"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    syncing === row.id && "animate-spin",
                  )}
                  strokeWidth={1.5}
                />
              </button>
            )}

            {/* Snapshot */}
            {row.status === "ended" && (
              <button
                onClick={onSnapshot}
                disabled={snapshotting === row.id}
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
                  snapshotting === row.id && "opacity-50 cursor-not-allowed",
                )}
                title="Generate snapshot"
              >
                <Camera className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </td>
      </tr>

      {/* Expanded teams sub-row */}
      {isExpanded && (
        <tr className="border-b border-border/50">
          <td colSpan={6} className="px-4 py-3 bg-accent/30">
            {expandedLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-48" />
                ))}
              </div>
            ) : expandedTeams.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No team data available.
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Registered Teams ({expandedTeams.length})
                </p>
                {expandedTeams.map((t) => (
                  <div
                    key={t.team_id}
                    className="flex items-center gap-3 text-sm"
                  >
                    <Users className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-foreground">{t.team_name}</span>
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
