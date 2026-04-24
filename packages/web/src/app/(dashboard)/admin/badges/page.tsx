"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  Plus,
  Shield,
  Star,
  Hexagon,
  Circle,
  Diamond,
  Crown,
  Flame,
  Zap,
  Heart,
  Sparkles,
  Archive,
  ArchiveRestore,
  UserPlus,
  Ban,
  Loader2,
  Shuffle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import { BadgeIcon, type BadgeIconType } from "@/components/badges/badge-icon";
import type { BadgeColorPalette } from "@pew/core";
import type { BadgeRow, BadgeAssignmentRow, UserSearchResult } from "@/lib/rpc-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabId = "definitions" | "assignments";
type AssignmentStatusFilter = "all" | "active" | "expired" | "revoked" | "cleared";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ICONS: { value: BadgeIconType; label: string; icon: LucideIcon }[] = [
  { value: "shield", label: "Shield", icon: Shield },
  { value: "star", label: "Star", icon: Star },
  { value: "crown", label: "Crown", icon: Crown },
  { value: "flame", label: "Flame", icon: Flame },
  { value: "zap", label: "Zap", icon: Zap },
  { value: "heart", label: "Heart", icon: Heart },
  { value: "sparkles", label: "Sparkles", icon: Sparkles },
  { value: "hexagon", label: "Hexagon", icon: Hexagon },
  { value: "circle", label: "Circle", icon: Circle },
  { value: "diamond", label: "Diamond", icon: Diamond },
];

const PALETTES: {
  value: BadgeColorPalette;
  label: string;
  bg: string;
  text: string;
}[] = [
  { value: "ocean", label: "Ocean", bg: "#3B82F6", text: "#FFFFFF" },
  { value: "forest", label: "Forest", bg: "#10B981", text: "#FFFFFF" },
  { value: "sunset", label: "Sunset", bg: "#F97316", text: "#FFFFFF" },
  { value: "royal", label: "Royal", bg: "#8B5CF6", text: "#FFFFFF" },
  { value: "crimson", label: "Crimson", bg: "#EF4444", text: "#FFFFFF" },
  { value: "gold", label: "Gold", bg: "#EAB308", text: "#1F2937" },
];

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function BadgesSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-xl bg-secondary p-4">
          <div className="flex items-center gap-4">
            <Skeleton className="h-8 w-8 rounded" />
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-16" />
            <div className="flex-1" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string }
> = {
  active: { label: "Active", color: "text-success", bg: "bg-success/15" },
  expired: {
    label: "Expired",
    color: "text-warning",
    bg: "bg-warning/15",
  },
  revoked_early: {
    label: "Revoked",
    color: "text-destructive",
    bg: "bg-destructive/15",
  },
  revoked_post_expiry: {
    label: "Cleared",
    color: "text-muted-foreground",
    bg: "bg-muted",
  },
};

function AssignmentStatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status];
  if (!config) {
    return (
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        Unknown
      </span>
    );
  }
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 text-[10px] font-medium",
        config.bg,
        config.color,
      )}
    >
      {config.label}
    </span>
  );
}

function ArchiveStatusBadge({ isArchived }: { isArchived: boolean }) {
  if (!isArchived) return null;
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      Archived
    </span>
  );
}

// ---------------------------------------------------------------------------
// Create Badge Dialog
// ---------------------------------------------------------------------------

interface CreateBadgeDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

function CreateBadgeDialog({ open, onClose, onCreated }: CreateBadgeDialogProps) {
  const [text, setText] = useState("");
  const [icon, setIcon] = useState<BadgeIconType>("star");
  const [palette, setPalette] = useState<BadgeColorPalette>("ocean");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Always exists because PALETTES is non-empty const array
  const defaultPalette = { value: "ocean" as const, label: "Ocean", bg: "#3B82F6", text: "#FFFFFF" };
  const selectedPalette = PALETTES.find((p) => p.value === palette) ?? defaultPalette;

  const randomize = () => {
    const randomIcon = ICONS[Math.floor(Math.random() * ICONS.length)];
    const randomPalette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    if (randomIcon) setIcon(randomIcon.value);
    if (randomPalette) setPalette(randomPalette.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/badges", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, icon, palette, description }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to create badge");
        setLoading(false);
        return;
      }

      onCreated();
      onClose();
      setText("");
      setIcon("star");
      setPalette("ocean");
      setDescription("");
    } catch {
      setError("Failed to create badge");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-background p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Create Badge</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Text */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Text (1-3 characters)
            </label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={3}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="MVP"
              required
            />
          </div>

          {/* Icon */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium">Icon</label>
              <button
                type="button"
                onClick={randomize}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <Shuffle className="h-3 w-3" />
                Randomize
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {ICONS.map((i) => {
                const IconComp = i.icon;
                return (
                  <button
                    key={i.value}
                    type="button"
                    onClick={() => setIcon(i.value)}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg border transition-colors",
                      icon === i.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/50",
                    )}
                    title={i.label}
                  >
                    <IconComp className="h-5 w-5" strokeWidth={1.5} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color Palette */}
          <div>
            <label className="mb-1 block text-sm font-medium">Color</label>
            <div className="flex gap-2">
              {PALETTES.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPalette(p.value)}
                  className={cn(
                    "h-10 w-10 rounded-lg border transition-colors",
                    palette === p.value
                      ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                      : "hover:ring-1 hover:ring-primary/50",
                  )}
                  style={{ backgroundColor: p.bg }}
                  title={p.label}
                />
              ))}
            </div>
          </div>

          {/* Preview */}
          <div>
            <label className="mb-1 block text-sm font-medium">Preview</label>
            <div className="flex items-center gap-4 rounded-lg bg-secondary p-4">
              <BadgeIcon
                text={text || "?"}
                icon={icon}
                colorBg={selectedPalette.bg}
                colorText={selectedPalette.text}
                size="lg"
              />
              <BadgeIcon
                text={text || "?"}
                icon={icon}
                colorBg={selectedPalette.bg}
                colorText={selectedPalette.text}
                size="md"
              />
              <BadgeIcon
                text={text || "?"}
                icon={icon}
                colorBg={selectedPalette.bg}
                colorText={selectedPalette.text}
                size="sm"
              />
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Description (optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Admin notes..."
              rows={2}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm hover:bg-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || text.trim().length === 0}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign Badge Dialog
// ---------------------------------------------------------------------------

interface AssignBadgeDialogProps {
  open: boolean;
  badges: BadgeRow[];
  onClose: () => void;
  onAssigned: () => void;
}

function AssignBadgeDialog({
  open,
  badges,
  onClose,
  onAssigned,
}: AssignBadgeDialogProps) {
  const [selectedBadgeId, setSelectedBadgeId] = useState<string>("");
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<UserSearchResult[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeBadges = badges.filter((b) => b.is_archived === 0);
  const selectedBadge = badges.find((b) => b.id === selectedBadgeId);

  // Search users
  useEffect(() => {
    if (userQuery.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: setState before/after fetch is the standard React pattern
      setUserResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/admin/users?q=${encodeURIComponent(userQuery)}&limit=10`,
        );
        if (res.ok) {
          const data = await res.json();
          setUserResults(data.users ?? []);
        }
      } catch {
        // ignore
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [userQuery]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBadgeId || !selectedUser) return;

    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/badges/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          badgeId: selectedBadgeId,
          userId: selectedUser.id,
          note,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to assign badge");
        setLoading(false);
        return;
      }

      onAssigned();
      onClose();
      setSelectedBadgeId("");
      setUserQuery("");
      setSelectedUser(null);
      setNote("");
    } catch {
      setError("Failed to assign badge");
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl bg-background p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Assign Badge</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Badge Selection */}
          <div>
            <label className="mb-1 block text-sm font-medium">Badge</label>
            <select
              value={selectedBadgeId}
              onChange={(e) => setSelectedBadgeId(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              required
            >
              <option value="">Select a badge...</option>
              {activeBadges.map((badge) => (
                <option key={badge.id} value={badge.id}>
                  {badge.text} ({badge.icon})
                </option>
              ))}
            </select>
            {selectedBadge && (
              <div className="mt-2 flex items-center gap-2">
                <BadgeIcon
                  text={selectedBadge.text}
                  icon={selectedBadge.icon as BadgeIconType}
                  colorBg={selectedBadge.color_bg}
                  colorText={selectedBadge.color_text}
                  size="md"
                />
                <span className="text-sm text-muted-foreground">
                  {selectedBadge.description || "No description"}
                </span>
              </div>
            )}
          </div>

          {/* User Search */}
          <div>
            <label className="mb-1 block text-sm font-medium">User</label>
            {selectedUser ? (
              <div className="flex items-center gap-2 rounded-lg bg-secondary p-2">
                {selectedUser.image && (
                  <Image
                    src={selectedUser.image}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 rounded-full"
                  />
                )}
                <div className="flex-1">
                  <p className="text-sm font-medium">{selectedUser.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedUser.email}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedUser(null);
                    setUserQuery("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
                  placeholder="Search users..."
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {userResults.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-background shadow-lg">
                    {userResults.map((user) => (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => {
                          setSelectedUser(user);
                          setUserResults([]);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary"
                      >
                        {user.image && (
                          <Image
                            src={user.image}
                            alt=""
                            width={24}
                            height={24}
                            className="h-6 w-6 rounded-full"
                          />
                        )}
                        <div>
                          <p className="text-sm">{user.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Duration info */}
          <div className="rounded-lg bg-secondary/50 p-3 text-sm">
            <p className="text-muted-foreground">
              Badge will be active for <strong>7 days</strong> from assignment.
            </p>
          </div>

          {/* Note */}
          <div>
            <label className="mb-1 block text-sm font-medium">
              Note (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none"
              placeholder="Reason for assignment..."
              rows={2}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm hover:bg-secondary"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedBadgeId || !selectedUser}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Assign
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Revoke/Clear Dialog (with reason input)
// ---------------------------------------------------------------------------

interface RevokeDialogProps {
  open: boolean;
  isActive: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

function RevokeDialog({ open, isActive, onClose, onConfirm }: RevokeDialogProps) {
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  const action = isActive ? "Revoke" : "Clear";

  /* eslint-disable react-hooks/set-state-in-effect -- reset state when dialog closes */
  useEffect(() => {
    if (!open) {
      setReason("");
      setLoading(false);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onConfirm(reason.trim());
    setLoading(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-lg">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive mb-4">
          <Ban className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <h2 className="text-center text-lg font-semibold text-foreground mb-2">
          {action} Assignment
        </h2>
        <p className="text-center text-sm text-muted-foreground mb-4">
          {isActive
            ? "This will immediately remove the badge from the user's leaderboard display."
            : "This will clear the expired assignment, allowing the badge to be re-assigned to this user."}
        </p>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">
              Reason <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-lg border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none resize-none"
              placeholder={isActive ? "Why is this badge being revoked?" : "Note for audit trail..."}
              rows={2}
            />
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="flex-1 rounded-lg border border-border bg-secondary px-4 py-2.5 text-sm font-medium text-foreground hover:bg-accent transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-lg bg-destructive px-4 py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors disabled:opacity-50"
            >
              {loading ? "..." : action}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge Definition Row
// ---------------------------------------------------------------------------

interface BadgeRowProps {
  badge: BadgeRow;
  onArchive: () => void;
  onUnarchive: () => void;
}

function BadgeDefinitionRow({ badge, onArchive, onUnarchive }: BadgeRowProps) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-secondary p-4">
      <BadgeIcon
        text={badge.text}
        icon={badge.icon as BadgeIconType}
        colorBg={badge.color_bg}
        colorText={badge.color_text}
        size="lg"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{badge.text}</span>
          <span className="text-sm text-muted-foreground">
            {badge.icon}
          </span>
          <ArchiveStatusBadge isArchived={badge.is_archived === 1} />
        </div>
        {badge.description && (
          <p className="text-sm text-muted-foreground">{badge.description}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {badge.is_archived === 0 ? (
          <button
            onClick={onArchive}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Archive className="h-4 w-4" />
            Archive
          </button>
        ) : (
          <button
            onClick={onUnarchive}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-success/10 hover:text-success"
          >
            <ArchiveRestore className="h-4 w-4" />
            Unarchive
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assignment Row
// ---------------------------------------------------------------------------

interface AssignmentRowProps {
  assignment: BadgeAssignmentRow;
  onRevoke: () => void;
}

function AssignmentRow({ assignment, onRevoke }: AssignmentRowProps) {
  const canRevoke = !assignment.revoked_at;

  return (
    <div className="flex items-center gap-4 rounded-xl bg-secondary p-4">
      <BadgeIcon
        text={assignment.snapshot_text}
        icon={assignment.snapshot_icon as BadgeIconType}
        colorBg={assignment.snapshot_bg}
        colorText={assignment.snapshot_fg}
        size="md"
      />
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {assignment.user_name ?? "Unknown"}
          </span>
          {assignment.user_slug && (
            <span className="text-sm text-muted-foreground">
              @{assignment.user_slug}
            </span>
          )}
          <AssignmentStatusBadge status={assignment.status} />
        </div>
        <p className="text-sm text-muted-foreground">
          Assigned {new Date(assignment.assigned_at).toLocaleDateString()}
          {" • "}
          {assignment.status === "active"
            ? `Expires ${new Date(assignment.expires_at).toLocaleDateString()}`
            : `Ended ${new Date(assignment.revoked_at ?? assignment.expires_at).toLocaleDateString()}`}
          {assignment.assigned_by_name && (
            <>
              {" • "}
              by {assignment.assigned_by_name}
            </>
          )}
        </p>
        {assignment.note && (
          <p className="mt-1 text-sm italic text-muted-foreground">
            {assignment.note}
          </p>
        )}
      </div>
      {canRevoke && (
        <button
          onClick={onRevoke}
          className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        >
          <Ban className="h-4 w-4" />
          {assignment.status === "active" ? "Revoke" : "Clear"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AdminBadgesPage() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();

  const [activeTab, setActiveTab] = useState<TabId>("definitions");
  const [badges, setBadges] = useState<BadgeRow[]>([]);
  const [assignments, setAssignments] = useState<BadgeAssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AssignmentStatusFilter>("all");

  // Revoke dialog state
  const [revokeTarget, setRevokeTarget] = useState<{
    assignmentId: string;
    isActive: boolean;
  } | null>(null);

  const { confirm, dialogProps } = useConfirm();

  // Load data
  const loadBadges = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/badges");
      if (!res.ok) throw new Error("Failed to load badges");
      const data = await res.json();
      setBadges(data.badges ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load badges");
    }
  }, []);

  const loadAssignments = useCallback(async () => {
    try {
      const statusParam = statusFilter === "all" ? "all" : statusFilter;
      const res = await fetch(
        `/api/admin/badges/assignments?status=${statusParam}&limit=100`,
      );
      if (!res.ok) throw new Error("Failed to load assignments");
      const data = await res.json();
      setAssignments(data.assignments ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load assignments",
      );
    }
  }, [statusFilter]);

  useEffect(() => {
    if (adminLoading) return;
    if (!isAdmin) {
      router.push("/dashboard");
      return;
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: setState before/after fetch is the standard React pattern
    setLoading(true);
    Promise.all([loadBadges(), loadAssignments()]).finally(() =>
      setLoading(false),
    );
  }, [isAdmin, adminLoading, router, loadBadges, loadAssignments]);

  // Reload assignments when filter changes
  useEffect(() => {
    if (!isAdmin || loading) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: setState before/after fetch is the standard React pattern
    loadAssignments();
  }, [statusFilter, isAdmin, loading, loadAssignments]);

  // Actions
  const handleArchive = async (badgeId: string) => {
    const confirmed = await confirm({
      title: "Archive Badge",
      description:
        "Archived badges cannot be assigned to users but remain visible on existing assignments.",
      confirmText: "Archive",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/admin/badges/${badgeId}/archive`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to archive badge");
      await loadBadges();
    } catch {
      setError("Failed to archive badge");
    }
  };

  const handleUnarchive = async (badgeId: string) => {
    try {
      const res = await fetch(`/api/admin/badges/${badgeId}/unarchive`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to unarchive badge");
      await loadBadges();
    } catch {
      setError("Failed to unarchive badge");
    }
  };

  const handleRevoke = async (assignmentId: string, isActive: boolean) => {
    // Open the revoke dialog
    setRevokeTarget({ assignmentId, isActive });
  };

  const handleRevokeConfirm = async (reason: string) => {
    if (!revokeTarget) return;
    const { assignmentId, isActive } = revokeTarget;
    const action = isActive ? "Revoke" : "Clear";

    try {
      const res = await fetch(
        `/api/admin/badges/assignments/${assignmentId}/revoke`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason || undefined }),
        },
      );
      if (!res.ok) throw new Error(`Failed to ${action.toLowerCase()} assignment`);
      await loadAssignments();
    } catch {
      setError(`Failed to ${action.toLowerCase()} assignment`);
    } finally {
      setRevokeTarget(null);
    }
  };

  if (adminLoading || (!isAdmin && !adminLoading)) {
    return (
      <div className="container max-w-4xl py-8">
        <Skeleton className="mb-6 h-8 w-48" />
        <BadgesSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Badges</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and assign badges to recognize users on the leaderboard.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAssignDialog(true)}
            className="flex items-center gap-2 rounded-lg bg-secondary px-4 py-2 text-sm hover:bg-secondary/80"
          >
            <UserPlus className="h-4 w-4" />
            Assign
          </button>
          <button
            onClick={() => setShowCreateDialog(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Create Badge
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-secondary/50 p-1">
        <button
          onClick={() => setActiveTab("definitions")}
          className={cn(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "definitions"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Definitions ({badges.length})
        </button>
        <button
          onClick={() => setActiveTab("assignments")}
          className={cn(
            "flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors",
            activeTab === "assignments"
              ? "bg-background shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Assignments ({assignments.length})
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <BadgesSkeleton />
      ) : activeTab === "definitions" ? (
        <div className="space-y-3">
          {badges.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No badges created yet. Create your first badge!
            </p>
          ) : (
            badges.map((badge) => (
              <BadgeDefinitionRow
                key={badge.id}
                badge={badge}
                onArchive={() => handleArchive(badge.id)}
                onUnarchive={() => handleUnarchive(badge.id)}
              />
            ))
          )}
        </div>
      ) : (
        <>
          {/* Status filter */}
          <div className="mb-4 flex gap-2">
            {(["all", "active", "expired", "revoked", "cleared"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  "rounded-full px-3 py-1 text-sm capitalize transition-colors",
                  statusFilter === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="space-y-3">
            {assignments.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">
                No assignments found.
              </p>
            ) : (
              assignments.map((assignment) => (
                <AssignmentRow
                  key={assignment.id}
                  assignment={assignment}
                  onRevoke={() =>
                    handleRevoke(assignment.id, assignment.status === "active")
                  }
                />
              ))
            )}
          </div>
        </>
      )}

      {/* Dialogs */}
      <CreateBadgeDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onCreated={loadBadges}
      />
      <AssignBadgeDialog
        open={showAssignDialog}
        badges={badges}
        onClose={() => setShowAssignDialog(false)}
        onAssigned={loadAssignments}
      />
      <RevokeDialog
        open={revokeTarget !== null}
        isActive={revokeTarget?.isActive ?? true}
        onClose={() => setRevokeTarget(null)}
        onConfirm={handleRevokeConfirm}
      />
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
