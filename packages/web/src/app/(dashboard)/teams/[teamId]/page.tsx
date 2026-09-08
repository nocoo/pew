"use client";

import { useState, useCallback, useRef } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
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
import { Banner } from "@nocoo/basalt/components/banner";
import { Button } from "@nocoo/basalt/components/button";
import { Input } from "@nocoo/basalt/components/input";
import { Switch } from "@nocoo/basalt/components/switch";
import { rowIconClassName } from "@/components/ui/button";
import { StatusBadge } from "@/components/leaderboard/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import { MessageBanner, type MessageBannerMsg } from "@/components/ui/message-banner";
import { InviteDialog, useInviteDialog } from "@/components/teams/invite-dialog";
import {
  useSeasonRegistration,
  type AvailableSeason,
} from "@/hooks/use-season-registration";
import { formatSeasonDate } from "@/lib/seasons";
import { UserProfileDialog } from "@/components/user-profile-dialog";
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
  logoUrl: string | null;
}

// ---------------------------------------------------------------------------
// Season registration row
// ---------------------------------------------------------------------------

function SeasonRow({
  season,
  onRegister,
  onWithdraw,
  busy,
  hideActions,
}: {
  season: AvailableSeason;
  onRegister: (seasonId: string) => void;
  onWithdraw: (seasonId: string) => void;
  busy: string | null;
  hideActions?: boolean;
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

      {/* Hide action buttons when auto-register is enabled */}
      {!hideActions && (
        <div className="shrink-0">
          {season.is_registered ? (
            // Can withdraw from upcoming seasons, or active seasons with late withdrawal enabled
            season.status === "upcoming" || (season.status === "active" && season.allow_late_withdrawal) ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => onWithdraw(season.id)}
                disabled={isBusy}
                loading={isBusy}
              >
                {isBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
                ) : (
                  <>
                    <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                    <span>Withdraw</span>
                  </>
                )}
              </Button>
            ) : null
          ) : season.status === "upcoming" || (season.status === "active" && season.allow_late_registration) ? (
            <Button
              type="button"
              size="sm"
              onClick={() => onRegister(season.id)}
              disabled={isBusy}
              loading={isBusy}
            >
              {isBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              ) : (
                <>
                  <Trophy className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span>Register</span>
                </>
              )}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto-Register Toggle
// ---------------------------------------------------------------------------

function AutoRegisterToggle({
  teamId,
  initialValue,
  onToggle,
}: {
  teamId: string;
  initialValue: boolean;
  onToggle?: (newValue: boolean) => void;
}) {
  const [enabled, setEnabled] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  const handleToggle = async () => {
    const newValue = !enabled;
    setEnabled(newValue);
    onToggle?.(newValue);
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
        onToggle?.(!newValue);
      }
    } catch (err) {
      console.error("Auto-register toggle error:", err);
      setEnabled(!newValue);
      onToggle?.(!newValue);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start gap-3 rounded-lg bg-accent/50 px-4 py-3">
      <Switch
        checked={enabled}
        disabled={saving}
        onCheckedChange={() => {
          void handleToggle();
        }}
        aria-label="Automatically register this team for new seasons"
        className="mt-0.5"
      />
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

function SeasonRegistration({
  teamId,
  autoRegisterEnabled,
}: {
  teamId: string;
  autoRegisterEnabled: boolean;
}) {
  const { seasons, loading, error, register, withdraw } =
    useSeasonRegistration({ teamId });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<MessageBannerMsg | null>(null);

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

  // When auto-register is enabled, don't show season list (team auto-joins all)
  if (autoRegisterEnabled) {
    return null;
  }

  return (
    <div className="space-y-3">
      <MessageBanner message={message} />

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

  const { data: team, error: swrError, isLoading: loading, mutate: mutateTeam } =
    useSWR<TeamDetail>(teamId ? `/api/teams/${teamId}` : null, fetcher);
  const error = swrError
    ? swrError instanceof Error
      ? swrError.message
      : "Failed to load team"
    : null;
  const [message, setMessage] = useState<MessageBannerMsg | null>(null);

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

  // Auto-register: sync from SWR data using render-time update pattern.
  const [autoRegisterEnabled, setAutoRegisterEnabled] = useState(false);
  const [prevTeamId, setPrevTeamId] = useState<string | null>(null);
  const [prevAutoRegister, setPrevAutoRegister] = useState<boolean | null>(null);
  if (team && (team.id !== prevTeamId || team.auto_register_season !== prevAutoRegister)) {
    setPrevTeamId(team.id);
    setPrevAutoRegister(team.auto_register_season);
    setAutoRegisterEnabled(team.auto_register_season);
  }

  const handleMemberClick = useCallback((member: TeamMember) => {
    setDialogMember(member);
    setDialogOpen(true);
  }, []);

  const fetchTeam = useCallback(() => {
    void mutateTeam();
  }, [mutateTeam]);

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
      confirmLabel: "Remove",
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
      confirmLabel: "Remove",
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
      confirmLabel: isSoloOwner ? "Delete" : "Leave",
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
        <Button
          type="button"
          variant="ghost"
          onClick={() => router.push("/teams")}
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Back to Teams
        </Button>
        <Banner variant="error" title={error ?? "Team not found"} />
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
      <Button
        type="button"
        variant="ghost"
        onClick={() => router.push("/teams")}
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        Back to Teams
      </Button>

      {/* Message */}
      <MessageBanner message={message} />

      {/* Header */}
      <div>
        <div className="flex items-start gap-4">
          {/* Team Logo */}
          <div className="relative shrink-0 group">
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-accent text-muted-foreground overflow-hidden">
              {team.logoUrl ? (
                // biome-ignore lint/performance/noImgElement: user-supplied image URL, not amenable to next/image domain allowlist -- external team logos
                <img
                  src={team.logoUrl}
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
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => logoInputRef.current?.click()}
                  disabled={uploadingLogo}
                  className="absolute inset-0 h-auto w-auto rounded-xl bg-black/50 opacity-0 group-hover:opacity-100 hover:bg-black/50"
                  aria-label="Change logo"
                >
                  {uploadingLogo ? (
                    <Loader2 className="h-4 w-4 text-white animate-spin" strokeWidth={2} />
                  ) : (
                    <Camera className="h-4 w-4 text-white" strokeWidth={1.5} />
                  )}
                </Button>
                {team.logoUrl && (
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    onClick={handleRemoveLogo}
                    className="absolute -top-1 -right-1 h-5 w-5 opacity-0 group-hover:opacity-100"
                    aria-label="Remove logo"
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </Button>
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
                <Input
                  ref={editInputRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={64}
                  className="min-w-0 flex-1 text-lg font-semibold"
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
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`${rowIconClassName} shrink-0 text-basalt-muted-foreground/50 group-hover/name:text-basalt-muted-foreground`}
                    onClick={startEditing}
                    aria-label="Rename team"
                  >
                    <Pencil strokeWidth={1.5} />
                  </Button>
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
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0"
              onClick={() => openInviteDialog(team.name, team.invite_code)}
            >
              <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Invite
            </Button>
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
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleMemberClick(member)}
                className="h-auto min-w-0 flex-1 justify-start gap-3 px-0 py-0 hover:bg-transparent hover:opacity-80"
              >
                <Avatar className="h-7 w-7 shrink-0">
                  {member.image && <AvatarImage src={member.image} />}
                  <AvatarFallback className="text-xs">
                    {(member.name ?? "?").charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <p className="min-w-0 flex-1 truncate text-left text-sm text-foreground">
                  {member.name ?? "Unknown"}
                </p>
              </Button>
              {member.role === "owner" ? (
                <span className="text-xs font-medium text-primary shrink-0">
                  Owner
                </span>
              ) : isOwner ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 hover:bg-basalt-destructive/10 hover:text-basalt-destructive"
                  onClick={(e) => handleKick(e, member)}
                  aria-label={`Remove ${member.name ?? "member"}`}
                >
                  <UserMinus className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span className="hidden sm:inline">Remove</span>
                </Button>
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
            {autoRegisterEnabled
              ? "Your team is automatically registered for all upcoming seasons."
              : "Register your team for upcoming seasons to compete on the leaderboard. Rosters are frozen at registration time."}
          </p>
          <div className="space-y-3">
            <AutoRegisterToggle
              teamId={team.id}
              initialValue={team.auto_register_season}
              onToggle={setAutoRegisterEnabled}
            />
            <SeasonRegistration
              teamId={team.id}
              autoRegisterEnabled={autoRegisterEnabled}
            />
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
          <Button
            type="button"
            size="sm"
            variant={isSoloOwner ? "destructive" : "secondary"}
            onClick={handleLeaveOrDelete}
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
          </Button>
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
