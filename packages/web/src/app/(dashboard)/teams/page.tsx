"use client";

import { useCallback, useId, useState } from "react";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
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
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@nocoo/basalt/components/button";
import { Empty } from "@nocoo/basalt/components/empty";
import { Input } from "@nocoo/basalt/components/input";
import { Label } from "@nocoo/basalt/components/label";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { MessageBanner, type MessageBannerMsg } from "@/components/ui/message-banner";
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
        // biome-ignore lint/performance/noImgElement: user-supplied image URL, not amenable to next/image domain allowlist -- external team logos
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
      confirmLabel: isOwner ? "Delete" : "Leave",
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
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => openInviteDialog(team.name, team.invite_code)}
              aria-label="Invite members"
            >
              <UserPlus className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span className="hidden sm:inline">Invite</span>
            </Button>
          )}
          {/* Leave/delete button — hidden for owner when other members exist */}
          {!(isOwner && hasOtherMembers) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleLeave}
              className={isOwner ? "hover:bg-basalt-destructive/10 hover:text-basalt-destructive" : undefined}
              aria-label={isOwner ? "Delete team" : "Leave team"}
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
            </Button>
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
  const { data: teamsData, mutate: mutateTeams } = useSWR<{ teams: Team[] }>(
    "/api/teams",
    fetcher,
  );
  const teams = teamsData?.teams ?? [];
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [showJoinTeam, setShowJoinTeam] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [joiningTeam, setJoiningTeam] = useState(false);
  const [teamMessage, setTeamMessage] = useState<MessageBannerMsg | null>(null);
  const uid = useId();
  const newTeamNameId = `${uid}-new-team-name`;
  const inviteCodeId = `${uid}-invite-code`;
  const { data: session } = useSession();
  const currentUserId = session?.user?.id ?? null;

  const fetchTeams = useCallback(() => {
    void mutateTeams();
  }, [mutateTeams]);

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
      <PageHeader
        title="Teams"
        description="Create or join teams to share usage data with your group."
      />

      {/* Teams Section */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Users className="h-4 w-4" strokeWidth={1.5} />
            Your Teams
          </h2>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setShowJoinTeam(!showJoinTeam);
                setShowCreateTeam(false);
              }}
            >
              <LogIn className="h-3.5 w-3.5" strokeWidth={1.5} />
              Join
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setShowCreateTeam(!showCreateTeam);
                setShowJoinTeam(false);
              }}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
              Create
            </Button>
          </div>
        </div>

        {/* Team message */}
        <MessageBanner message={teamMessage} className="mb-3" />

        {/* Create team form */}
        {showCreateTeam && (
          <div className="rounded-xl bg-secondary p-4 mb-3">
            <Label htmlFor={newTeamNameId}>Team Name</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id={newTeamNameId}
                type="text"
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                placeholder="My Team"
                maxLength={64}
                className="min-w-0 flex-1"
                onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()}
              />
              <Button
                type="button"
                onClick={handleCreateTeam}
                disabled={creatingTeam || !newTeamName.trim()}
                loading={creatingTeam}
                className="shrink-0"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                {creatingTeam ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        )}

        {/* Join team form */}
        {showJoinTeam && (
          <div className="rounded-xl bg-secondary p-4 mb-3">
            <Label htmlFor={inviteCodeId}>Invite Code</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id={inviteCodeId}
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="e.g. abc12345"
                maxLength={32}
                className="min-w-0 flex-1 font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleJoinTeam()}
              />
              <Button
                type="button"
                onClick={handleJoinTeam}
                disabled={joiningTeam || !inviteCode.trim()}
                loading={joiningTeam}
                className="shrink-0"
              >
                <LogIn className="h-3.5 w-3.5" strokeWidth={1.5} />
                {joiningTeam ? "Joining..." : "Join"}
              </Button>
            </div>
          </div>
        )}

        {/* Teams list */}
        {teams.length === 0 ? (
          <Empty
            title="You're not in any teams yet."
            description="Create one or join with an invite code."
            className="rounded-basalt-card bg-basalt-secondary p-6"
          />
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
