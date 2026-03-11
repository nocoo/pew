"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import {
  Users,
  Plus,
  LogIn,
  Copy,
  Check,
  Trash2,
  Camera,
  X,
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
  logo_url: string;
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
  const [logoError, setLogoError] = useState(false);
  const [logoVer, setLogoVer] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Client-side validation
    if (!file.type.startsWith("image/png") && !file.type.startsWith("image/jpeg")) {
      onMessage({ type: "error", text: "Only PNG and JPEG images are accepted." });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      onMessage({ type: "error", text: "File too large (max 2 MB)." });
      return;
    }

    // Validate square aspect ratio on the client
    const valid = await validateSquare(file);
    if (!valid) {
      onMessage({ type: "error", text: "Image must be square." });
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
        setLogoError(false);
        setLogoVer(Date.now());
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
      // Reset input so the same file can be re-selected
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemoveLogo = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Remove team logo?")) return;

    try {
      const res = await fetch(`/api/teams/${team.id}/logo`, { method: "DELETE" });
      if (res.ok) {
        onMessage({ type: "success", text: "Logo removed." });
        setLogoError(true);
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

  const logoSrc = `${team.logo_url}?v=${logoVer}`;

  return (
    <div className="relative group shrink-0">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-muted-foreground overflow-hidden">
        {!logoError ? (
          <img
            src={logoSrc}
            alt={`${team.name} logo`}
            className="h-9 w-9 object-cover"
            onError={() => setLogoError(true)}
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
          {!logoError && (
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

function validateSquare(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src);
      resolve(img.naturalWidth === img.naturalHeight);
    };
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      resolve(false);
    };
    img.src = URL.createObjectURL(file);
  });
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
  // Leave team
  // ---------------------------------------------------------------------------

  const handleLeaveTeam = async (teamId: string) => {
    if (!confirm("Are you sure you want to leave this team?")) return;
    setTeamMessage(null);

    try {
      const res = await fetch(`/api/teams/${teamId}`, { method: "DELETE" });
      if (res.ok) {
        setTeamMessage({ type: "success", text: "Left team." });
        fetchTeams();
      } else {
        const data = await res.json().catch(() => ({}));
        setTeamMessage({
          type: "error",
          text: (data as { error?: string }).error ?? "Failed to leave team.",
        });
      }
    } catch {
      setTeamMessage({ type: "error", text: "Network error." });
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="max-w-3xl space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-display">Teams</h1>
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
              <div
                key={team.id}
                className="rounded-xl bg-secondary p-4"
              >
                <div className="flex items-center gap-3">
                  <TeamLogo
                    team={team}
                    isOwner={currentUserId === team.created_by}
                    onUploaded={fetchTeams}
                    onMessage={setTeamMessage}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{team.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {team.member_count} member{team.member_count !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Invite code */}
                    <div className="hidden sm:flex items-center gap-1 rounded-md bg-accent px-2 py-1">
                      <code className="text-[10px] font-mono text-muted-foreground">
                        {team.invite_code}
                      </code>
                      <CopyButton text={team.invite_code} />
                    </div>
                    {/* Leave button */}
                    <button
                      onClick={() => handleLeaveTeam(team.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Leave team"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
