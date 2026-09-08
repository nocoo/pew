"use client";

import { useState, useEffect, useId } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  X,
  Check,
  Upload,
  Building2,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Button } from "@nocoo/basalt/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@nocoo/basalt/components/dialog";
import { Input } from "@nocoo/basalt/components/input";
import { chromeIconClassName, rowIconClassName, rowIconDangerClassName } from "@/components/ui/button";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { RowListSkeleton } from "@/components/ui/row-list-skeleton";
import { MessageBanner, type MessageBannerMsg } from "@/components/ui/message-banner";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import { toErrorMessage } from "@/lib/error-message";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  memberCount: number;
  createdAt: string;
}

interface MemberRow {
  id: string;
  userId: string;
  joinedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    slug: string | null;
  };
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function OrgsSkeleton() {
  return (
    <RowListSkeleton
      rows={4}
      leadingClassName="h-10 w-10 rounded-lg"
      middle={["w-32", "w-16"]}
      tail={["w-16"]}
    />
  );
}

// ---------------------------------------------------------------------------
// Logo component
// ---------------------------------------------------------------------------

function OrgLogo({
  logoUrl,
  name,
  size = "md",
}: {
  logoUrl: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
}) {
  const [error, setError] = useState(false);
  const sizeClasses = {
    sm: "h-6 w-6",
    md: "h-10 w-10",
    lg: "h-16 w-16",
  };

  if (!logoUrl || error) {
    return (
      <div
        className={cn(
          sizeClasses[size],
          "rounded-lg bg-muted flex items-center justify-center"
        )}
      >
        <Building2
          className={cn(
            "text-muted-foreground",
            size === "sm" ? "h-3 w-3" : size === "md" ? "h-5 w-5" : "h-8 w-8"
          )}
          strokeWidth={1.5}
        />
      </div>
    );
  }

  return (
    // biome-ignore lint/performance/noImgElement: user-supplied image URL, not amenable to next/image domain allowlist
    <img
      src={logoUrl}
      alt={name}
      className={cn(sizeClasses[size], "rounded-lg object-cover")}
      onError={() => setError(true)}
    />
  );
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

function CreateOrgForm({
  onCreated,
  onCancel,
}: {
  onCreated: (msg: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const nameId = `${uid}-name`;
  const slugId = `${uid}-slug`;

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
      const res = await fetch("/api/admin/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), slug: slug.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { name: string };
      onCreated(`Organization "${data.name}" created.`);
    } catch (err) {
      setError(toErrorMessage(err, "Failed to create."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="rounded-xl bg-secondary p-4">
      <h3 className="text-sm font-medium text-foreground mb-3">
        Create Organization
      </h3>
      {error && (
        <div className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive mb-3">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor={nameId} className="block text-xs font-medium text-muted-foreground mb-1">
            Name
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Anthropic"
            maxLength={64}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
          />
        </div>
        <div>
          <label htmlFor={slugId} className="block text-xs font-medium text-muted-foreground mb-1">
            Slug
          </label>
          <input
            id={slugId}
            type="text"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="anthropic"
            maxLength={32}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
          />
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4">
        <button type="button"
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || !slug.trim()}
          className={cn(
            "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
            (submitting || !name.trim() || !slug.trim()) &&
              "opacity-50 cursor-not-allowed"
          )}
        >
          {submitting ? "Creating..." : "Create"}
        </button>
        <button type="button"
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
// Edit form (inline)
// ---------------------------------------------------------------------------

function EditOrgRow({
  org,
  onSaved,
  onCancel,
}: {
  org: OrgRow;
  onSaved: (msg: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(org.name);
  const [slug, setSlug] = useState(org.slug);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const nameId = `${uid}-name`;
  const slugId = `${uid}-slug`;

  const handleSave = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      if (name.trim() !== org.name) payload.name = name.trim();
      if (slug.trim() !== org.slug) payload.slug = slug.trim();

      if (Object.keys(payload).length === 0) {
        onCancel();
        return;
      }

      const res = await fetch(`/api/admin/organizations/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onSaved(`Organization "${name.trim()}" updated.`);
    } catch (err) {
      setError(toErrorMessage(err, "Failed to update."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <tr className="border-b border-border/50">
      <td colSpan={5} className="px-4 py-3">
        {error && (
          <div className="rounded-lg bg-destructive/10 p-2 text-xs text-destructive mb-2">
            {error}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor={nameId} className="block text-xs font-medium text-muted-foreground mb-1">
              Name
            </label>
            <input
              id={nameId}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
            />
          </div>
          <div>
            <label htmlFor={slugId} className="block text-xs font-medium text-muted-foreground mb-1">
              Slug
            </label>
            <input
              id={slugId}
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={32}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button type="button"
            onClick={handleSave}
            disabled={submitting || !name.trim() || !slug.trim()}
            className={cn(
              "flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
              (submitting || !name.trim() || !slug.trim()) &&
                "opacity-50 cursor-not-allowed"
            )}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={1.5} />
            {submitting ? "Saving..." : "Save"}
          </button>
          <button type="button"
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
// Members modal
// ---------------------------------------------------------------------------

function MembersModal({
  org,
  onClose,
  onMemberRemoved,
}: {
  org: OrgRow;
  onClose: () => void;
  onMemberRemoved: () => void;
}) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; name: string | null; email: string; image: string | null }[]>([]);
  const [searching, setSearching] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const { confirm, dialogProps } = useConfirm();

  useEffect(() => {
    const fetchMembers = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/organizations/${org.id}/members`);
        if (res.ok) {
          const data = (await res.json()) as { members: MemberRow[] };
          setMembers(data.members);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    };
    fetchMembers();
  }, [org.id]);

  const handleRemove = async (member: MemberRow) => {
    const confirmed = await confirm({
      title: "Remove member?",
      description: `Remove ${member.user.name || member.user.email} from ${org.name}?`,
      confirmLabel: "Remove",
    });
    if (!confirmed) return;

    setRemoving(member.userId);
    try {
      const res = await fetch(
        `/api/admin/organizations/${org.id}/members/${member.userId}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        setMembers((prev) => prev.filter((m) => m.userId !== member.userId));
        onMemberRemoved();
      }
    } catch {
      // ignore
    } finally {
      setRemoving(null);
    }
  };

  // Search for users to add
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/admin/users?q=${encodeURIComponent(searchQuery.trim())}&limit=10`);
      if (res.ok) {
        const data = (await res.json()) as { users: { id: string; name: string | null; email: string; image: string | null }[] };
        // Filter out users who are already members
        const memberIds = new Set(members.map((m) => m.userId));
        setSearchResults(data.users.filter((u) => !memberIds.has(u.id)));
      }
    } catch {
      // ignore
    } finally {
      setSearching(false);
    }
  };

  // Add a user as member
  const handleAddMember = async (user: { id: string; name: string | null; email: string; image: string | null }) => {
    setAdding(true);
    try {
      const res = await fetch(`/api/admin/organizations/${org.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      if (res.ok) {
        const newMember = (await res.json()) as MemberRow;
        setMembers((prev) => [newMember, ...prev]);
        setSearchResults((prev) => prev.filter((u) => u.id !== user.id));
        setSearchQuery("");
        onMemberRemoved(); // Refresh parent to update member count
      }
    } catch {
      // ignore
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
        <DialogContent size="lg">
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
            <div className="flex items-center gap-3 pr-16">
              <OrgLogo logoUrl={org.logoUrl} name={org.name} size="sm" />
              <div className="min-w-0">
                <DialogTitle className="text-sm">{org.name}</DialogTitle>
                <DialogDescription>Members ({members.length})</DialogDescription>
              </div>
              <Button
                type="button"
                variant={showAddForm ? "default" : "ghost"}
                size="icon"
                className={rowIconClassName}
                onClick={() => setShowAddForm(!showAddForm)}
                aria-label="Add member"
              >
                <UserPlus strokeWidth={1.5} />
              </Button>
            </div>
          </DialogHeader>

          {showAddForm && (
            <div className="mt-4 space-y-2">
              <div className="flex gap-2">
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  placeholder="Search users by name or email..."
                />
                <Button
                  type="button"
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim()}
                  loading={searching}
                >
                  {searching ? "..." : "Search"}
                </Button>
              </div>
              {searchResults.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {searchResults.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors"
                    >
                      {user.image ? (
                        // biome-ignore lint/performance/noImgElement: user-supplied image URL, not amenable to next/image domain allowlist
                        <img
                          src={user.image}
                          alt={user.name ?? ""}
                          className="h-7 w-7 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                          {(user.name ?? user.email)[0]?.toUpperCase()}
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">
                          {user.name ?? "Anonymous"}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {user.email}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => handleAddMember(user)}
                        disabled={adding}
                      >
                        Add
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-4">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton loader; array order and length are stable within a single render pass so index is a legitimate key.
                  <Skeleton key={`slot-${i}`} className="h-12 w-full" />
                ))}
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No members yet.
              </p>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    {member.user.image ? (
                      // biome-ignore lint/performance/noImgElement: user-supplied image URL, not amenable to next/image domain allowlist
                      <img
                        src={member.user.image}
                        alt={member.user.name ?? ""}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-medium text-muted-foreground">
                        {(member.user.name ?? member.user.email)[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {member.user.name ?? "Anonymous"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {member.user.email}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className={rowIconDangerClassName}
                      onClick={() => handleRemove(member)}
                      disabled={removing === member.userId}
                      aria-label="Remove member"
                    >
                      <Trash2 strokeWidth={1.5} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog {...dialogProps} />
    </>
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

export default function AdminOrganizationsPage() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();

  const {
    data: orgData,
    error: swrError,
    isLoading: loading,
    mutate: mutateRows,
  } = useSWR<{ organizations: OrgRow[] }>(
    isAdmin ? "/api/admin/organizations" : null,
    fetcher
  );
  const rows = orgData?.organizations ?? [];
  const error = swrError
    ? swrError instanceof Error
      ? swrError.message
      : "Failed to load."
    : null;
  const [message, setMessage] = useState<MessageBannerMsg | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [membersOrg, setMembersOrg] = useState<OrgRow | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const { confirm, dialogProps } = useConfirm();

  // Redirect non-admins
  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/");
    }
  }, [adminLoading, isAdmin, router]);

  // Fetch rows
  const fetchRows = () => mutateRows();

  // Delete org
  const handleDelete = async (org: OrgRow) => {
    const confirmed = await confirm({
      title: "Delete organization?",
      description: `This will permanently delete "${org.name}" and remove all ${org.memberCount} member(s).`,
      confirmLabel: "Delete",
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/admin/organizations/${org.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setMessage({ type: "success", text: `Organization "${org.name}" deleted.` });
      fetchRows();
    } catch (err) {
      setMessage({
        type: "error",
        text: toErrorMessage(err, "Failed to delete."),
      });
    }
  };

  // Upload logo
  const handleLogoUpload = async (org: OrgRow, file: File) => {
    setUploadingId(org.id);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/admin/organizations/${org.id}/logo`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setMessage({ type: "success", text: `Logo updated for "${org.name}".` });
      fetchRows();
    } catch (err) {
      setMessage({
        type: "error",
        text: toErrorMessage(err, "Failed to upload logo."),
      });
    } finally {
      setUploadingId(null);
    }
  };

  // Guard
  if (adminLoading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80 mt-2" />
        </div>
        <OrgsSkeleton />
      </div>
    );
  }

  if (!isAdmin) return null;

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Organizations"
        description="Manage interest-based organizations. Users can join to filter leaderboards."
        actions={
          <Button
            onClick={() => {
              setShowCreate(!showCreate);
              setEditingId(null);
            }}
          >
            <Plus strokeWidth={1.5} />
            Create Organization
          </Button>
        }
      />

      {/* Messages */}
      <MessageBanner message={message} />

      {/* Error */}
      <ErrorBanner messagePrefix="Failed to load organizations" error={error} />

      {/* Create form */}
      {showCreate && (
        <CreateOrgForm
          onCreated={(msg) => {
            setShowCreate(false);
            setMessage({ type: "success", text: msg });
            fetchRows();
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {/* Loading */}
      {loading && <OrgsSkeleton />}

      {/* Table */}
      {!loading && (
        rows.length === 0 ? (
            <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
              No organizations yet. Create one to get started.
            </div>
          ) : (
            <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Organization
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                      Slug
                    </th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground">
                      Members
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">
                      Created
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-32">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) =>
                    editingId === row.id ? (
                      <EditOrgRow
                        key={row.id}
                        org={row}
                        onSaved={(msg) => {
                          setEditingId(null);
                          setMessage({ type: "success", text: msg });
                          fetchRows();
                        }}
                        onCancel={() => setEditingId(null)}
                      />
                    ) : (
                      <tr
                        key={row.id}
                        className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <OrgLogo
                                logoUrl={row.logoUrl}
                                name={row.name}
                                size="md"
                              />
                              <label
                                className={cn(
                                  "absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg opacity-0 hover:opacity-100 transition-opacity cursor-pointer",
                                  uploadingId === row.id && "opacity-100"
                                )}
                              >
                                <Upload
                                  className={cn(
                                    "h-4 w-4 text-white",
                                    uploadingId === row.id && "animate-pulse"
                                  )}
                                />
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg"
                                  className="hidden"
                                  disabled={uploadingId === row.id}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) handleLogoUpload(row, file);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>
                            <span className="text-sm font-medium text-foreground">
                              {row.name}
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-sm font-mono text-muted-foreground">
                            {row.slug}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm tabular-nums text-muted-foreground">
                            {row.memberCount}
                          </span>
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="text-xs text-muted-foreground">
                            {new Date(row.createdAt).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className={rowIconClassName}
                              onClick={() => {
                                setEditingId(row.id);
                                setShowCreate(false);
                              }}
                              aria-label="Edit"
                            >
                              <Pencil strokeWidth={1.5} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={rowIconClassName}
                              onClick={() => setMembersOrg(row)}
                              aria-label="View members"
                            >
                              <Users strokeWidth={1.5} />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className={rowIconDangerClassName}
                              onClick={() => handleDelete(row)}
                              aria-label="Delete"
                            >
                              <Trash2 strokeWidth={1.5} />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )
      )}

      {/* Members modal */}
      {membersOrg && (
        <MembersModal
          org={membersOrg}
          onClose={() => setMembersOrg(null)}
          onMemberRemoved={fetchRows}
        />
      )}

      {/* Confirm dialog */}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
