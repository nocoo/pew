"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
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
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { RowListSkeleton } from "@/components/ui/row-list-skeleton";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@nocoo/basalt/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nocoo/basalt/components/dialog";
import { Field } from "@nocoo/basalt/components/field";
import { Input } from "@nocoo/basalt/components/input";
import { InputArea } from "@nocoo/basalt/components/input-area";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nocoo/basalt/components/select";
import { chromeIconClassName } from "@/lib/ghost-icon";
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
    <RowListSkeleton
      rows={5}
      leadingClassName="h-8 w-8 rounded"
      middle={["w-20", "w-16"]}
      tail={["w-24"]}
    />
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
  const uid = useId();
  const textId = `${uid}-text`;
  const descriptionId = `${uid}-description`;

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

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`absolute top-4 right-4 ${chromeIconClassName}`}
            aria-label="Close"
          >
            <X aria-hidden="true" strokeWidth={1.5} />
          </Button>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>Create Badge</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Field label="Text (1-3 characters)" htmlFor={textId}>
            <Input
              id={textId}
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={3}
              placeholder="MVP"
              required
            />
          </Field>

          {/* Icon */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-sm font-medium">Icon</span>
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
            <span className="mb-1 block text-sm font-medium">Color</span>
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
            <span className="mb-1 block text-sm font-medium">Preview</span>
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

          <Field label="Description (optional)" htmlFor={descriptionId} required={false}>
            <InputArea
              id={descriptionId}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Admin notes..."
              rows={2}
            />
          </Field>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || text.trim().length === 0} loading={loading}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserSearchResult | null>(null);
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const badgeSelectId = `${uid}-badge`;
  const userQueryId = `${uid}-user-query`;
  const noteId = `${uid}-note`;

  const activeBadges = badges.filter((b) => b.is_archived === 0);
  const selectedBadge = badges.find((b) => b.id === selectedBadgeId);

  // Debounce the user query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(userQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [userQuery]);

  // Search users via SWR
  const { data: searchData, isLoading: searching } = useSWR<{
    users: UserSearchResult[];
  }>(
    debouncedQuery.length >= 2
      ? `/api/admin/users?q=${encodeURIComponent(debouncedQuery)}&limit=10`
      : null,
    fetcher
  );
  const userResults = searchData?.users ?? [];

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

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`absolute top-4 right-4 ${chromeIconClassName}`}
            aria-label="Close"
          >
            <X aria-hidden="true" strokeWidth={1.5} />
          </Button>
        </DialogClose>
        <DialogHeader>
          <DialogTitle>Assign Badge</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <Field label="Badge" htmlFor={badgeSelectId}>
            <Select
              value={selectedBadgeId || "__pending__"}
              onValueChange={(next) => {
                if (next !== "__pending__") setSelectedBadgeId(next);
              }}
            >
              <SelectTrigger id={badgeSelectId} aria-label="Badge">
                <SelectValue placeholder="Select a badge..." />
              </SelectTrigger>
              <SelectContent className="max-h-[min(24rem,var(--radix-select-content-available-height))] overflow-y-auto">
                {activeBadges.map((badge) => (
                  <SelectItem key={badge.id} value={badge.id}>
                    {badge.text} ({badge.icon})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {selectedBadge && (
            <div className="flex items-center gap-2">
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

          <Field label="User" htmlFor={userQueryId}>
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
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedUser(null);
                    setUserQuery("");
                  }}
                >
                  Change
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Input
                  id={userQueryId}
                  type="text"
                  value={userQuery}
                  onChange={(e) => setUserQuery(e.target.value)}
                  placeholder="Search users..."
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {userResults.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-background shadow-lg">
                    {userResults.map((user) => (
                      <Button
                        key={user.id}
                        type="button"
                        variant="ghost"
                        className="h-auto w-full justify-start gap-2 px-3 py-2"
                        onClick={() => {
                          setSelectedUser(user);
                          setUserQuery("");
                          setDebouncedQuery("");
                        }}
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
                        <div className="text-left">
                          <p className="text-sm">{user.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {user.email}
                          </p>
                        </div>
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Field>

          <div className="rounded-lg bg-secondary/50 p-3 text-sm">
            <p className="text-muted-foreground">
              Badge will be active for <strong>7 days</strong> from assignment.
            </p>
          </div>

          <Field label="Note (optional)" htmlFor={noteId} required={false}>
            <InputArea
              id={noteId}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reason for assignment..."
              rows={2}
            />
          </Field>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading || !selectedBadgeId || !selectedUser}
              loading={loading}
            >
              Assign
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  const [prevOpen, setPrevOpen] = useState(open);
  const uid = useId();
  const reasonId = `${uid}-reason`;

  const action = isActive ? "Revoke" : "Clear";

  // Reset form state when dialog closes (render-time)
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (!open) {
      setReason("");
      setLoading(false);
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await onConfirm(reason.trim());
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent>
        <DialogClose asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`absolute top-4 right-4 ${chromeIconClassName}`}
            aria-label="Close"
          >
            <X aria-hidden="true" strokeWidth={1.5} />
          </Button>
        </DialogClose>
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <Ban className="h-6 w-6" strokeWidth={1.5} />
        </div>
        <DialogHeader className="text-center">
          <DialogTitle className="text-center">{action} Assignment</DialogTitle>
          <DialogDescription className="text-center">
            {isActive
              ? "This will immediately remove the badge from the user's leaderboard display."
              : "This will clear the expired assignment, allowing the badge to be re-assigned to this user."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="mt-4">
          <Field label="Reason (optional)" htmlFor={reasonId} required={false}>
            <InputArea
              id={reasonId}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={isActive ? "Why is this badge being revoked?" : "Note for audit trail..."}
              rows={2}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={loading} loading={loading}>
              {loading ? "..." : action}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
          <button type="button"
            onClick={onArchive}
            className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Archive className="h-4 w-4" />
            Archive
          </button>
        ) : (
          <button type="button"
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
        <button type="button"
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

  // SWR-backed data
  const {
    data: badgesData,
    isLoading: badgesLoading,
    mutate: mutateBadges,
  } = useSWR<{ badges: BadgeRow[] }>(
    isAdmin ? "/api/admin/badges" : null,
    fetcher
  );
  const badges = badgesData?.badges ?? [];

  const statusParam = statusFilter === "all" ? "all" : statusFilter;
  const {
    data: assignmentsData,
    isLoading: assignmentsLoading,
    mutate: mutateAssignments,
  } = useSWR<{ assignments: BadgeAssignmentRow[] }>(
    isAdmin ? `/api/admin/badges/assignments?status=${statusParam}&limit=100` : null,
    fetcher
  );
  const assignments = assignmentsData?.assignments ?? [];

  const loading = badgesLoading || assignmentsLoading;

  const loadBadges = useCallback(() => mutateBadges(), [mutateBadges]);
  const loadAssignments = useCallback(
    () => mutateAssignments(),
    [mutateAssignments]
  );

  useEffect(() => {
    if (adminLoading) return;
    if (!isAdmin) {
      router.push("/dashboard");
    }
  }, [isAdmin, adminLoading, router]);

  // Actions
  const handleArchive = async (badgeId: string) => {
    const confirmed = await confirm({
      title: "Archive Badge",
      description:
        "Archived badges cannot be assigned to users but remain visible on existing assignments.",
      confirmLabel: "Archive",
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
      <PageHeader
        title="Badges"
        description="Create and assign badges to recognize users on the leaderboard."
        actions={
          <>
            <Button variant="secondary" onClick={() => setShowAssignDialog(true)}>
              <UserPlus />
              Assign
            </Button>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus />
              Create Badge
            </Button>
          </>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg bg-secondary/50 p-1">
        <button type="button"
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
        <button type="button"
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
          <button type="button"
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
              <button type="button"
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
