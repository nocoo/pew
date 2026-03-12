"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import {
  Users,
  Plus,
  LogIn,
  Copy,
  Check,
  Trash2,
  ChevronRight,
  Camera,
  X,
  ChevronDown,
  ChevronUp,
  Pencil,
  UserMinus,
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  logo_url: string | null;
}

interface TeamMember {
  userId: string;
  name: string | null;
  image: string | null;
  role: string;
  joinedAt: string;
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
// TeamLogo — displays logo with upload overlay for owners
// ---------------------------------------------------------------------------

function TeamLogo({
  team,
  isOwner,
  onUploaded,
  onMessage,
}: {
  team: Team;
  isOwner: boolean;
  onUploaded: () => void;
  onMessage: (msg: { type: "success" | "error"; text: string }) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Always reset the input so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = "";

    // Client-side validation
    if (!file.type.startsWith("image/png") && !file.type.startsWith("image/jpeg")) {
      onMessage({ type: "error", text: "Only PNG and JPEG images are accepted." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      onMessage({ type: "error", text: "File too large (max 2 MB)." });
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/teams/${team.id}/logo`, {
        method: "POST",
        body: formData,
      });

      if (res.ok) {
        onMessage({ type: "success", text: "Logo updated!" });
        onUploaded();
      } else {
        const data = await res.json().catch(() => ({}));
        onMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to upload logo.",
        });
      }
    } catch {
      onMessage({ type: "error", text: "Network error." });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveLogo = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Remove team logo?")) return;

    try {
      const res = await fetch(`/api/teams/${team.id}/logo`, { method: "DELETE" });
      if (res.ok) {
        onMessage({ type: "success", text: "Logo removed." });
        onUploaded();
      } else {
        const data = await res.json().catch(() => ({}));
        onMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to remove logo.",
        });
      }
    } catch {
      onMessage({ type: "error", text: "Network error." });
    }
  };

  const hasLogo = !!team.logo_url;

  return (
    <div className="relative group shrink-0">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-muted-foreground overflow-hidden">
        {hasLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- external team logos
          <img
            src={team.logo_url!}
            alt={`${team.name} logo`}
            className="h-9 w-9 object-cover"
          />
        ) : (
          <Users className="h-4 w-4" strokeWidth={1.5} />
        )}
      </div>
      {isOwner && (
        <>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Change logo"
          >
            <Camera className="h-3.5 w-3.5 text-white" strokeWidth={1.5} />
          </button>
          {hasLogo && (
            <button
              onClick={handleRemoveLogo}
              className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white opacity-0 group-hover:opacity-100 transition-opacity"
              title="Remove logo"
            >
              <X className="h-2.5 w-2.5" strokeWidth={2} />
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            onChange={handleFileChange}
            className="hidden"
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TeamCard — single team with expandable members, rename, kick
// ---------------------------------------------------------------------------

const MAX_VISIBLE_MEMBERS = 5;

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

  // Expandable member list (owner only)
  const [expanded, setExpanded] = useState(false);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  // Inline rename (owner only)
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(team.name);
  const [saving, setSaving] = useState(false);
  const editInputRef = useRef<HTMLInputElement>(null);

  // -------------------------------------------------------------------------
  // Fetch members on expand
  // -------------------------------------------------------------------------

  const fetchMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const res = await fetch(`/api/teams/${team.id}`);
      if (res.ok) {
        const data = await res.json();
        setMembers(data.members ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoadingMembers(false);
    }
  }, [team.id]);

  const toggleExpand = () => {
    if (!isOwner) return;
    const next = !expanded;
    setExpanded(next);
    if (next && members.length === 0) {
      fetchMembers();
    }
  };

  // -------------------------------------------------------------------------
  // Rename
  // -------------------------------------------------------------------------

  const startEditing = () => {
    setEditName(team.name);
    setEditing(true);
    // Focus after render
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const cancelEditing = () => {
    setEditing(false);
    setEditName(team.name);
  };

  const handleRename = async () => {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === team.name) {
      cancelEditing();
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/teams/${team.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });

      if (res.ok) {
        onMessage({ type: "success", text: "Team renamed." });
        setEditing(false);
        onRefresh();
      } else {
        const data = await res.json().catch(() => ({}));
        onMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to rename.",
        });
      }
    } catch {
      onMessage({ type: "error", text: "Network error." });
    } finally {
      setSaving(false);
    }
  };

  // -------------------------------------------------------------------------
  // Kick member
  // -------------------------------------------------------------------------

  const handleKick = async (userId: string, memberName: string | null) => {
    const displayName = memberName ?? "this member";
    if (!confirm(`Remove ${displayName} from the team?`)) return;

    try {
      const res = await fetch(`/api/teams/${team.id}/members/${userId}`, {
        method: "DELETE",
      });

      if (res.ok) {
        onMessage({ type: "success", text: `${displayName} removed.` });
        // Refresh members and team list (member_count changed)
        fetchMembers();
        onRefresh();
      } else {
        const data = await res.json().catch(() => ({}));
        onMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to remove member.",
        });
      }
    } catch {
      onMessage({ type: "error", text: "Network error." });
    }
  };

  // -------------------------------------------------------------------------
  // Leave team
  // -------------------------------------------------------------------------

  const handleLeave = async () => {
    const msg = isOwner
      ? "Delete this team? This cannot be undone."
      : "Are you sure you want to leave this team?";
    if (!confirm(msg)) return;

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

  const visibleMembers = members.slice(0, MAX_VISIBLE_MEMBERS);

  return (
    <div className="rounded-xl bg-secondary p-4">
      {/* Header row */}
      <div className="flex items-center gap-3">
        <TeamLogo
          team={team}
          isOwner={isOwner}
          onUploaded={onRefresh}
          onMessage={onMessage}
        />
        <div className="flex-1 min-w-0">
          {/* Team name — inline editable for owner */}
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={editInputRef}
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={64}
                className="rounded-md border border-border bg-background px-2 py-0.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow min-w-0 w-full"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") cancelEditing();
                }}
                onBlur={handleRename}
                disabled={saving}
              />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 group/name">
              <Link
                href={`/teams/${team.id}`}
                className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors"
              >
                {team.name}
              </Link>
              {isOwner && (
                <button
                  onClick={startEditing}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground/0 group-hover/name:text-muted-foreground hover:!text-foreground transition-colors"
                  title="Rename team"
                >
                  <Pencil className="h-3 w-3" strokeWidth={1.5} />
                </button>
              )}
            </div>
          )}
          {/* Member count — clickable for owner to expand */}
          {isOwner ? (
            <button
              onClick={toggleExpand}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <span>
                {team.member_count} member{team.member_count !== 1 ? "s" : ""}
              </span>
              {expanded ? (
                <ChevronUp className="h-3 w-3" strokeWidth={1.5} />
              ) : (
                <ChevronDown className="h-3 w-3" strokeWidth={1.5} />
              )}
            </button>
          ) : (
            <p className="text-xs text-muted-foreground">
              {team.member_count} member{team.member_count !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Invite code */}
          <div className="hidden sm:flex items-center gap-1 rounded-md bg-accent px-2 py-1">
            <code className="text-[10px] font-mono text-muted-foreground">
              {team.invite_code}
            </code>
            <CopyButton text={team.invite_code} />
          </div>
          {/* Leave/delete button — hidden for owner when other members exist */}
          {!(isOwner && hasOtherMembers) && (
            <button
              onClick={handleLeave}
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              title={isOwner ? "Delete team" : "Leave team"}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
          {/* Navigate to detail */}
          <Link
            href={`/teams/${team.id}`}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            title="View team"
          >
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.5} />
          </Link>
        </div>
      </div>

      {/* Expanded member list */}
      {isOwner && expanded && (
        <div className="mt-3 border-t border-border/50 pt-3">
          {loadingMembers ? (
            <p className="text-xs text-muted-foreground">Loading members...</p>
          ) : visibleMembers.length === 0 ? (
            <p className="text-xs text-muted-foreground">No members found.</p>
          ) : (
            <ul className="space-y-2">
              {visibleMembers.map((m) => (
                <li key={m.userId} className="flex items-center gap-2.5">
                  {/* Avatar */}
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-muted-foreground overflow-hidden">
                    {m.image ? (
                      // eslint-disable-next-line @next/next/no-img-element -- external user avatars
                      <img src={m.image} alt="" className="h-6 w-6 object-cover" />
                    ) : (
                      <span className="text-[10px] font-medium">
                        {(m.name ?? "?")[0]?.toUpperCase()}
                      </span>
                    )}
                  </div>
                  {/* Name + role */}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-foreground truncate block">
                      {m.name ?? "Unknown"}
                    </span>
                  </div>
                  {m.role === "owner" ? (
                    <span className="text-[10px] font-medium text-muted-foreground px-1.5 py-0.5 rounded bg-accent">
                      Owner
                    </span>
                  ) : (
                    <button
                      onClick={() => handleKick(m.userId, m.name)}
                      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title={`Remove ${m.name ?? "member"}`}
                    >
                      <UserMinus className="h-3 w-3" strokeWidth={1.5} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {members.length > MAX_VISIBLE_MEMBERS && (
            <p className="mt-2 text-[10px] text-muted-foreground">
              +{members.length - MAX_VISIBLE_MEMBERS} more member{members.length - MAX_VISIBLE_MEMBERS !== 1 ? "s" : ""}
            </p>
          )}
        </div>
      )}
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
                  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0",
                  (creatingTeam || !newTeamName.trim()) && "opacity-50 cursor-not-allowed",
                )}
              >
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
                  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0",
                  (joiningTeam || !inviteCode.trim()) && "opacity-50 cursor-not-allowed",
                )}
              >
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
