"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import {
  Plus,
  Pencil,
  Camera,
  Users,
  X,
  Check,
  ChevronUp,
  RefreshCw,
  UserPlus,
  ArrowLeftRight,
  LogOut,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Banner } from "@nocoo/basalt/components/banner";
import { Button } from "@nocoo/basalt/components/button";
import { Empty } from "@nocoo/basalt/components/empty";
import { StatusBadge as SharedStatusBadge } from "@/components/leaderboard/status-badge";
import { Checkbox } from "@nocoo/basalt/components/checkbox";
import { Field } from "@nocoo/basalt/components/field";
import { Input } from "@nocoo/basalt/components/input";
import { rowIconClassName } from "@/components/ui/button";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { RowListSkeleton } from "@/components/ui/row-list-skeleton";
import { MessageBanner, type MessageBannerMsg } from "@/components/ui/message-banner";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import { toErrorMessage } from "@/lib/error-message";
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
    <RowListSkeleton
      rows={4}
      middle={["w-32", "w-16"]}
      tail={["w-24", "w-16"]}
    />
  );
}

function StatusBadge({ status }: { status: SeasonStatus }) {
  return <SharedStatusBadge status={status} />;
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
  const uid = useId();
  const nameId = `${uid}-name`;
  const slugId = `${uid}-slug`;
  const startDateId = `${uid}-start-date`;
  const endDateId = `${uid}-end-date`;

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
      setError(toErrorMessage(err, "Failed to create."));
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
        <Banner variant="error" size="sm" className="mb-3" description={error} />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name" htmlFor={nameId}>
          <Input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Season 1"
            maxLength={64}
          />
        </Field>
        <Field label="Slug" htmlFor={slugId}>
          <Input
            id={slugId}
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="season-1"
            maxLength={32}
            className="font-mono"
          />
        </Field>
        <Field label="Start Date" htmlFor={startDateId}>
          <Input
            id={startDateId}
            type="datetime-local"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="tabular-nums"
          />
        </Field>
        <Field label="End Date" htmlFor={endDateId}>
          <Input
            id={endDateId}
            type="datetime-local"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="tabular-nums"
          />
        </Field>
      </div>
      <Checkbox.Group
        className="mt-3"
        value={[
          ...(allowLateRegistration ? ["late-reg"] : []),
          ...(allowRosterChanges ? ["roster"] : []),
          ...(allowLateWithdrawal ? ["late-wd"] : []),
        ]}
        onValueChange={(next) => {
          setAllowLateRegistration(next.includes("late-reg"));
          setAllowRosterChanges(next.includes("roster"));
          setAllowLateWithdrawal(next.includes("late-wd"));
        }}
      >
        <Checkbox.Legend className="text-xs font-medium text-muted-foreground">
          Rules
        </Checkbox.Legend>
        <Checkbox.Item value="late-reg">Allow late registration</Checkbox.Item>
        <Checkbox.Item value="roster">Allow roster changes</Checkbox.Item>
        <Checkbox.Item value="late-wd">Allow late withdrawal</Checkbox.Item>
      </Checkbox.Group>
      <div className="flex items-center gap-2 mt-4">
        <Button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || !slug.trim() || !startDate || !endDate}
          loading={submitting}
        >
          {submitting ? "Creating..." : "Create"}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
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
  const uid = useId();
  const nameId = `${uid}-name`;
  const slugId = `${uid}-slug`;
  const startDateId = `${uid}-start-date`;
  const endDateId = `${uid}-end-date`;

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
      setError(toErrorMessage(err, "Failed to update."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <tr className="border-b border-border/50">
      <td colSpan={6} className="px-4 py-3">
        {error && (
          <Banner variant="error" size="sm" className="mb-2" description={error} />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Name" htmlFor={nameId}>
            <Input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
            />
          </Field>
          <Field label="Slug (read-only)" htmlFor={slugId}>
            <Input id={slugId} type="text" value={season.slug} disabled className="font-mono" />
          </Field>
          <Field label={`Start Date${!isUpcoming ? " (locked)" : ""}`} htmlFor={startDateId}>
            <Input
              id={startDateId}
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              disabled={!isUpcoming}
              className="tabular-nums"
            />
          </Field>
          <Field label={`End Date${!isUpcoming ? " (locked)" : ""}`} htmlFor={endDateId}>
            <Input
              id={endDateId}
              type="datetime-local"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              disabled={!isUpcoming}
              className="tabular-nums"
            />
          </Field>
        </div>
        <Checkbox.Group
          className="mt-3"
          value={[
            ...(allowLateRegistration ? ["late-reg"] : []),
            ...(allowRosterChanges ? ["roster"] : []),
            ...(allowLateWithdrawal ? ["late-wd"] : []),
          ]}
          onValueChange={(next) => {
            setAllowLateRegistration(next.includes("late-reg"));
            setAllowRosterChanges(next.includes("roster"));
            setAllowLateWithdrawal(next.includes("late-wd"));
          }}
        >
          <Checkbox.Legend className="text-xs font-medium text-muted-foreground">
            Rules
          </Checkbox.Legend>
          <Checkbox.Item value="late-reg">Allow late registration</Checkbox.Item>
          <Checkbox.Item value="roster">Allow roster changes</Checkbox.Item>
          <Checkbox.Item value="late-wd">Allow late withdrawal</Checkbox.Item>
        </Checkbox.Group>
        <div className="flex items-center gap-2 mt-3">
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={submitting || !name.trim()}
            loading={submitting}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
            {submitting ? "Saving..." : "Save"}
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={onCancel}>
            <X className="h-3.5 w-3.5" strokeWidth={1.5} />
            Cancel
          </Button>
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

  const {
    data: seasonData,
    error: swrError,
    isLoading: loading,
    mutate: mutateRows,
  } = useSWR<{ seasons: SeasonRow[] }>(
    isAdmin ? "/api/admin/seasons" : null,
    fetcher
  );
  const rows = seasonData?.seasons ?? [];
  const error = swrError
    ? swrError instanceof Error
      ? swrError.message
      : "Failed to load."
    : null;
  const [message, setMessage] = useState<MessageBannerMsg | null>(null);

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

  const fetchRows = useCallback(() => mutateRows(), [mutateRows]);

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
      confirmLabel: "Generate Snapshot",
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
        text: toErrorMessage(err, "Failed to create snapshot."),
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
        text: toErrorMessage(err, "Failed to sync rosters."),
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
      <PageHeader
        title="Seasons"
        description="Manage competition seasons. Teams register and compete on token usage."
        actions={
          <Button
            onClick={() => {
              setShowCreate(!showCreate);
              setEditingId(null);
            }}
          >
            <Plus strokeWidth={1.5} />
            Create Season
          </Button>
        }
      />

      {/* Messages */}
      <MessageBanner message={message} />

      {/* Error */}
      <ErrorBanner messagePrefix="Failed to load seasons" error={error} />

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
        rows.length === 0 ? (
            <Empty
              title="No seasons yet. Create one to get started."
              className="rounded-basalt-card bg-basalt-secondary p-8"
            />
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
          )
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
            <Button
              variant="ghost"
              size="icon"
              className={rowIconClassName}
              onClick={onEdit}
              aria-label="Edit season"
            >
              <Pencil strokeWidth={1.5} />
            </Button>

            {/* View teams */}
            {row.team_count > 0 && (
              <Button
                variant="ghost"
                size="icon"
                className={rowIconClassName}
                onClick={onToggleTeams}
                aria-label="View registered teams"
              >
                {isExpanded ? (
                  <ChevronUp strokeWidth={1.5} />
                ) : (
                  <Users strokeWidth={1.5} />
                )}
              </Button>
            )}

            {/* Sync rosters */}
            {row.status === "active" && row.allow_roster_changes && (
              <Button
                variant="ghost"
                size="icon"
                className={rowIconClassName}
                onClick={onSyncRosters}
                disabled={syncing === row.id}
                aria-label="Sync rosters"
              >
                <RefreshCw
                  className={cn(syncing === row.id && "animate-spin")}
                  strokeWidth={1.5}
                />
              </Button>
            )}

            {/* Snapshot */}
            {row.status === "ended" && (
              <Button
                variant="ghost"
                size="icon"
                className={rowIconClassName}
                onClick={onSnapshot}
                disabled={snapshotting === row.id}
                aria-label="Generate snapshot"
              >
                <Camera strokeWidth={1.5} />
              </Button>
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
                  // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton loader; array order and length are stable within a single render pass so index is a legitimate key.
                  <Skeleton key={`slot-${i}`} className="h-4 w-48" />
                ))}
              </div>
            ) : expandedTeams.length === 0 ? (
              <Empty title="No team data available." />
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
