"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Users,
  ArrowLeft,
  Trophy,
  LogOut,
  Loader2,
  UserMinus,
  UserPlus,
  Trash2,
  Camera,
  Pencil,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import { InviteDialog, useInviteDialog } from "@/components/teams/invite-dialog";
import {
  useSeasonRegistration,
  type AvailableSeason,
} from "@/hooks/use-season-registration";
import { formatSeasonDate } from "@/lib/seasons";
import { UserProfileDialog } from "@/components/user-profile-dialog";
import type { SeasonStatus } from "@pew/core";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TeamMember {
  userId: string;
  name: string | null;
  slug: string | null;
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
  auto_register_season: boolean;
  logo_url: string | null;
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
          // Can withdraw from upcoming seasons, or active seasons with late withdrawal enabled
          season.status === "upcoming" || (season.status === "active" && season.allow_late_withdrawal) ? (
            <button
              onClick={() => onWithdraw(season.id)}
              disabled={isBusy}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive hover:border-destructive/50 transition-colors",
                isBusy && "opacity-50 cursor-not-allowed",
              )}
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <>
                  <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>Withdraw</span>
                </>
              )}
            </button>
          ) : null
        ) : season.status === "upcoming" || (season.status === "active" && season.allow_late_registration) ? (
          <button
            onClick={() => onRegister(season.id)}
            disabled={isBusy}
            className={cn(
              "flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
              isBusy && "opacity-50 cursor-not-allowed",
            )}
          >
            {isBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            ) : (
              <>
                <Trophy className="h-3.5 w-3.5" strokeWidth={1.5} />
                <span>Register</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-Register Toggle
// ---------------------------------------------------------------------------

function AutoRegisterToggle({
  teamId,
  initialValue,
}: {
  teamId: string;
  initialValue: boolean;
}) {
  const [enabled, setEnabled] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const handleToggle = async () => {
    const newValue = !enabled;
    setEnabled(newValue);
    setSaving(true);

    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_register_season: newValue }),
      });

      if (!res.ok) {
        // Revert on failure
        const errorText = await res.text();
        console.error("Auto-register toggle failed:", res.status, errorText);
        setEnabled(!newValue);
      }
    } catch (err) {
      console.error("Auto-register toggle error:", err);
      setEnabled(!newValue);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start gap-3 rounded-lg bg-accent/50 px-4 py-3">
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        disabled={saving}
        onClick={handleToggle}
        className={cn(
          "relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
          enabled ? "bg-primary" : "bg-border",
          saving && "opacity-50 cursor-not-allowed",
        )}
      >
        <span
          className={cn(
            "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-sm ring-0 transition-transform",
            enabled ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-foreground">
            Auto-register for new seasons
          </p>
          {saving && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" strokeWidth={1.5} />
          )}
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">
          When enabled, your team will be automatically registered for every new
          season. You can still manually withdraw from individual seasons.
        </p>
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
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Profile dialog state
  const [dialogMember, setDialogMember] = useState<TeamMember | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Confirm dialog for kick/delete
  const { confirm, dialogProps } = useConfirm();

  // Invite dialog
  const { openInviteDialog, dialogProps: inviteDialogProps } = useInviteDialog();

  // Logo upload
  const logoInputRef = useRef<HTMLInputElement>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Rename
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [savingName, setSavingName] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  const handleMemberClick = useCallback((member: TeamMember) => {
    setDialogMember(member);
    setDialogOpen(true);
  }, []);

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
  // Logo upload/remove (owner only)
  // -------------------------------------------------------------------------

  const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input so the same file can be re-selected
    if (logoInputRef.current) logoInputRef.current.value = "";

    // Client-side validation
    if (!file.type.startsWith("image/png") && !file.type.startsWith("image/jpeg")) {
      setMessage({ type: "error", text: "Only PNG and JPEG images are accepted." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ type: "error", text: "File too large (max 2 MB)." });
      return;
    }

    setUploadingLogo(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/teams/${teamId}/logo`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Logo updated!" });
        fetchTeam();
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to upload logo.",
        });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleRemoveLogo = async () => {
    const confirmed = await confirm({
      title: "Remove team logo?",
      description: "The current logo will be deleted. You can upload a new one anytime.",
      confirmText: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/teams/${teamId}/logo`, { method: "DELETE" });
      if (res.ok) {
        setMessage({ type: "success", text: "Logo removed." });
        fetchTeam();
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to remove logo.",
        });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    }
  };

  // -------------------------------------------------------------------------
  // Rename (owner only)
  // -------------------------------------------------------------------------

  const startEditing = () => {
    if (!team) return;
    setEditName(team.name);
    setEditing(true);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditName("");
  };

  const handleRename = async () => {
    if (!team) return;
    const trimmed = editName.trim();
    if (!trimmed || trimmed === team.name) {
      cancelEditing();
      return;
    }

    setSavingName(true);
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (res.ok) {
        setMessage({ type: "success", text: "Team renamed." });
        setEditing(false);
        fetchTeam();
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to rename.",
        });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    } finally {
      setSavingName(false);
    }
  };

  // -------------------------------------------------------------------------
  // Kick member (owner only)
  // -------------------------------------------------------------------------

  const handleKick = async (e: React.MouseEvent, member: TeamMember) => {
    e.stopPropagation(); // Don't trigger profile dialog
    const displayName = member.name ?? "this member";

    const confirmed = await confirm({
      title: `Remove ${displayName}?`,
      description: `${displayName} will be removed from the team and will need a new invite to rejoin.`,
      confirmText: "Remove",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/teams/${teamId}/members/${member.userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        setMessage({ type: "success", text: `${displayName} removed.` });
        fetchTeam();
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to remove member.",
        });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    }
  };

  // -------------------------------------------------------------------------
  // Leave or delete team
  // -------------------------------------------------------------------------

  const handleLeaveOrDelete = async () => {
    if (!team) return;
    const isOwner = team.role === "owner";
    const isSoloOwner = isOwner && team.members.length === 1;

    const confirmed = await confirm({
      title: isSoloOwner ? "Delete team?" : isOwner ? "Leave team?" : "Leave team?",
      description: isSoloOwner
        ? "This will permanently delete the team and all its data. This action cannot be undone."
        : "You will be removed from this team. You can rejoin if you have a valid invite code.",
      confirmText: isSoloOwner ? "Delete" : "Leave",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/teams");
      } else {
        const data = await res.json().catch(() => ({}));
        setMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to leave team.",
        });
      }
    } catch {
      setMessage({ type: "error", text: "Network error." });
    }
  };

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
  const isSoloOwner = isOwner && team.members.length === 1;

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

      {/* Message */}
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

      {/* Header */}
      <div>
        <div className="flex items-start gap-4">
          {/* Team Logo */}
          <div className="relative shrink-0 group">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent text-muted-foreground overflow-hidden">
              {team.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element -- external team logos
                <img
                  src={team.logo_url}
                  alt={`${team.name} logo`}
                  className="h-14 w-14 object-cover"
                />
              ) : (
                <Users className="h-6 w-6" strokeWidth={1.5} />
              )}
            </div>
            {/* Logo edit overlay (owner only, hover to show) */}
            {isOwner && (
              <>
                <button
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Change logo"
                >
                  {uploadingLogo ? (
                    <Loader2 className="h-4 w-4 text-white animate-spin" strokeWidth={2} />
                  ) : (
                    <Camera className="h-4 w-4 text-white" strokeWidth={1.5} />
                  )}
                </button>
                {team.logo_url && (
                  <button
                    onClick={handleRemoveLogo}
                    className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Remove logo"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                )}
              </>
            )}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleLogoChange}
              className="hidden"
            />
          </div>

          {/* Team Name + Info */}
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="flex items-center gap-2">
                <input
                  ref={editInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={64}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-lg font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow min-w-0 flex-1"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") cancelEditing();
                  }}
                  disabled={savingName}
                />
                {savingName && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" strokeWidth={1.5} />
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 group/name">
                <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight truncate">
                  {team.name}
                </h1>
                {isOwner && (
                  <button
                    onClick={startEditing}
                    className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/50 group-hover/name:text-muted-foreground hover:!text-foreground hover:bg-accent transition-colors shrink-0"
                    title="Rename team"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                  </button>
                )}
              </div>
            )}
            <p className="mt-1 text-sm text-muted-foreground">
              {team.members.length} member
              {team.members.length !== 1 ? "s" : ""}
              {isOwner && " · You are the owner"}
            </p>
          </div>

          {/* Invite button (owner only) */}
          {isOwner && (
            <button
              onClick={() => openInviteDialog(team.name, team.invite_code)}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors shrink-0"
            >
              <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Invite
            </button>
          )}
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
              <button
                onClick={() => handleMemberClick(member)}
                className="flex flex-1 items-center gap-3 text-left transition-colors hover:opacity-80 cursor-pointer min-w-0"
              >
                <Avatar className="h-7 w-7 shrink-0">
                  {member.image && <AvatarImage src={member.image} />}
                  <AvatarFallback className="text-xs">
                    {(member.name ?? "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="text-sm text-foreground truncate flex-1 min-w-0">
                  {member.name ?? "Unknown"}
                </p>
              </button>
              {member.role === "owner" ? (
                <span className="text-xs font-medium text-primary shrink-0">
                  Owner
                </span>
              ) : isOwner ? (
                <button
                  onClick={(e) => handleKick(e, member)}
                  className="flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                  title={`Remove ${member.name ?? "member"}`}
                >
                  <UserMinus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span className="hidden sm:inline">Remove</span>
                </button>
              ) : (
                <span className="text-xs font-medium text-muted-foreground shrink-0">
                  Member
                </span>
              )}
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
          <div className="space-y-3">
            <AutoRegisterToggle
              teamId={team.id}
              initialValue={team.auto_register_season}
            />
            <SeasonRegistration teamId={team.id} />
          </div>
        </section>
      )}

      {/* Leave/Delete Team */}
      <section>
        <div className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-foreground mb-2">
            {isSoloOwner ? "Delete Team" : "Leave Team"}
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {isSoloOwner
              ? "Permanently delete this team and all its data. This action cannot be undone."
              : isOwner
                ? "You cannot delete this team while other members remain. Remove all members first, or leave the team."
                : "Leave this team. You can rejoin if you have a valid invite code."}
          </p>
          <button
            onClick={handleLeaveOrDelete}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              isSoloOwner
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : "border border-border text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            {isSoloOwner ? (
              <>
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                Delete Team
              </>
            ) : (
              <>
                <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                Leave Team
              </>
            )}
          </button>
        </div>
      </section>

      {/* Profile dialog */}
      {dialogMember && (
        <UserProfileDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          slug={dialogMember.slug ?? dialogMember.userId}
          name={dialogMember.name}
          image={dialogMember.image}
        />
      )}

      {/* Confirm dialog */}
      <ConfirmDialog {...dialogProps} />

      {/* Invite dialog */}
      <InviteDialog {...inviteDialogProps} />
    </div>
  );
}
