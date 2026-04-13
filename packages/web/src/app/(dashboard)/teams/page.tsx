"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Users,
  Plus,
  LogIn,
  LogOut,
  Trash2,
  ChevronRight,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import { InviteDialog, useInviteDialog } from "@/components/teams/invite-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Team {
  id: string;
  name: string;
  slug: string;
  invite_code: string;
  created_by: string;
  member_count: number;
  logoUrl: string | null;
}

// ---------------------------------------------------------------------------
// TeamLogo — displays logo (display-only, no editing on list page)
// ---------------------------------------------------------------------------

function TeamLogo({ team }: { team: Team }) {
  const hasLogo = !!team.logoUrl;

  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-muted-foreground overflow-hidden">
      {hasLogo ? (
        // eslint-disable-next-line @next/next/no-img-element -- external team logos
        <img
          src={team.logoUrl as string}
          alt={`${team.name} logo`}
          className="h-9 w-9 object-cover"
        />
      ) : (
        <Users className="h-4 w-4" strokeWidth={1.5} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamCard — simplified team card (display only, editing on detail page)
// ---------------------------------------------------------------------------

function TeamCard({
  team,
  currentUserId,
  onMessage,
  onRefresh,
}: {
  team: Team;
  currentUserId: string | null;
  onMessage: (msg: { type: "success" | "error"; text: string }) => void;
  onRefresh: () => void;
}) {
  const isOwner = currentUserId === team.created_by;
  const hasOtherMembers = team.member_count > 1;

  const { confirm, dialogProps } = useConfirm();
  const { openInviteDialog, dialogProps: inviteDialogProps } = useInviteDialog();

  // -------------------------------------------------------------------------
  // Leave team
  // -------------------------------------------------------------------------

  const handleLeave = async () => {
    const confirmed = await confirm({
      title: isOwner ? "Delete team?" : "Leave team?",
      description: isOwner
        ? "This will permanently delete the team and all its data. This action cannot be undone."
        : "You will be removed from this team. You can rejoin if you have a valid invite code.",
      confirmText: isOwner ? "Delete" : "Leave",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/teams/${team.id}`, { method: "DELETE" });
      if (res.ok) {
        onMessage({ type: "success", text: isOwner ? "Team deleted." : "Left team." });
        onRefresh();
      } else {
        const data = await res.json().catch(() => ({}));
        onMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to leave team.",
        });
      }
    } catch {
      onMessage({ type: "error", text: "Network error." });
    }
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="rounded-xl bg-secondary p-4">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <TeamLogo team={team} />
        <div className="flex-1 min-w-0">
          {/* Team name — link to detail page */}
          <Link
            href={`/teams/${team.id}`}
            className="text-sm font-medium text-foreground truncate block hover:text-primary transition-colors"
          >
            {team.name}
          </Link>
          {/* Member count */}
          <p className="text-xs text-muted-foreground">
            {team.member_count} member{team.member_count !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Invite button (owner only) */}
          {isOwner && (
            <button
              onClick={() => openInviteDialog(team.name, team.invite_code)}
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Invite members"
            >
              <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="hidden sm:inline">Invite</span>
            </button>
          )}
          {/* Leave/delete button — hidden for owner when other members exist */}
          {!(isOwner && hasOtherMembers) && (
            <button
              onClick={handleLeave}
              className={cn(
                "flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                isOwner
                  ? "text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent",
              )}
              title={isOwner ? "Delete team" : "Leave team"}
            >
              {isOwner ? (
                <>
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span className="hidden sm:inline">Delete</span>
                </>
              ) : (
                <>
                  <LogOut className="h-3.5 w-3.5" strokeWidth={1.5} />
                  <span className="hidden sm:inline">Leave</span>
                </>
              )}
            </button>
          )}
          {/* Navigate to detail */}
          <Link
            href={`/teams/${team.id}`}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="View team"
          >
            <span>Details</span>
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Link>
        </div>
      </div>

      {/* Dialogs */}
      <ConfirmDialog {...dialogProps} />
      <InviteDialog {...inviteDialogProps} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Teams Page
// ---------------------------------------------------------------------------

export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [showJoinTeam, setShowJoinTeam] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joiningTeam, setJoiningTeam] = useState(false);
  const [teamMessage, setTeamMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? null;

  // ---------------------------------------------------------------------------
  // Fetch teams
  // ---------------------------------------------------------------------------

  const fetchTeams = useCallback(async () => {
    try {
      const res = await fetch("/api/teams");
      if (res.ok) {
        const data = await res.json();
        setTeams(data.teams ?? []);
      }
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  // ---------------------------------------------------------------------------
  // Create team
  // ---------------------------------------------------------------------------

  const handleCreateTeam = async () => {
    if (!newTeamName.trim()) return;
    setCreatingTeam(true);
    setTeamMessage(null);

    try {
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newTeamName.trim() }),
      });

      if (res.ok) {
        setNewTeamName("");
        setShowCreateTeam(false);
        setTeamMessage({ type: "success", text: "Team created!" });
        fetchTeams();
      } else {
        const data = await res.json().catch(() => ({}));
        setTeamMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to create team.",
        });
      }
    } catch {
      setTeamMessage({ type: "error", text: "Network error." });
    } finally {
      setCreatingTeam(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Join team
  // ---------------------------------------------------------------------------

  const handleJoinTeam = async () => {
    if (!inviteCode.trim()) return;
    setJoiningTeam(true);
    setTeamMessage(null);

    try {
      const res = await fetch("/api/teams/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invite_code: inviteCode.trim() }),
      });

      if (res.ok) {
        setInviteCode("");
        setShowJoinTeam(false);
        setTeamMessage({ type: "success", text: "Joined team!" });
        fetchTeams();
      } else {
        const data = await res.json().catch(() => ({}));
        setTeamMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to join team.",
        });
      }
    } catch {
      setTeamMessage({ type: "error", text: "Network error." });
    } finally {
      setJoiningTeam(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Teams</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Create or join teams to share usage data with your group.
        </p>
      </div>

      {/* Teams Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users className="h-4 w-4" strokeWidth={1.5} />
            Your Teams
          </h2>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setShowJoinTeam(!showJoinTeam);
                setShowCreateTeam(false);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <LogIn className="h-3.5 w-3.5" strokeWidth={1.5} />
              Join
            </button>
            <button
              onClick={() => {
                setShowCreateTeam(!showCreateTeam);
                setShowJoinTeam(false);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Create
            </button>
          </div>
        </div>

        {/* Team message */}
        {teamMessage && (
          <div
            className={cn(
              "rounded-lg p-3 text-xs mb-3",
              teamMessage.type === "success"
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive",
            )}
          >
            {teamMessage.text}
          </div>
        )}

        {/* Create team form */}
        {showCreateTeam && (
          <div className="rounded-xl bg-secondary p-4 mb-3">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Team Name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="My Team"
                maxLength={64}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow min-w-0"
                onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
              />
              <button
                onClick={handleCreateTeam}
                disabled={creatingTeam || !newTeamName.trim()}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0",
                  (creatingTeam || !newTeamName.trim()) && "opacity-50 cursor-not-allowed",
                )}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                {creatingTeam ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        )}

        {/* Join team form */}
        {showJoinTeam && (
          <div className="rounded-xl bg-secondary p-4 mb-3">
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Invite Code
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="e.g. abc12345"
                maxLength={32}
                className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow min-w-0"
                onKeyDown={(e) => e.key === "Enter" && handleJoinTeam()}
              />
              <button
                onClick={handleJoinTeam}
                disabled={joiningTeam || !inviteCode.trim()}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0",
                  (joiningTeam || !inviteCode.trim()) && "opacity-50 cursor-not-allowed",
                )}
              >
                <LogIn className="h-3.5 w-3.5" strokeWidth={1.5} />
                {joiningTeam ? "Joining..." : "Join"}
              </button>
            </div>
          </div>
        )}

        {/* Teams list */}
        {teams.length === 0 ? (
          <div className="rounded-xl bg-secondary p-6 text-center text-sm text-muted-foreground">
            You&apos;re not in any teams yet. Create one or join with an invite code.
          </div>
        ) : (
          <div className="space-y-2">
            {teams.map((team) => (
              <TeamCard
                key={team.id}
                team={team}
                currentUserId={currentUserId}
                onMessage={setTeamMessage}
                onRefresh={fetchTeams}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
