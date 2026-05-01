"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  X,
  Check,
  Upload,
  Building2,
  Search,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { RowListSkeleton } from "@/components/ui/row-list-skeleton";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";

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
    // eslint-disable-next-line @next/next/no-img-element
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
      setError(err instanceof Error ? err.message : "Failed to create.");
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
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder="Anthropic"
            maxLength={64}
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Slug
          </label>
          <input
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
        <button
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
        <button
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
      setError(err instanceof Error ? err.message : "Failed to update.");
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
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Slug
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={32}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
            />
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <button
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
          <button
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
      confirmText: "Remove",
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
      <div
        className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="bg-background rounded-xl shadow-lg w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-3">
              <OrgLogo logoUrl={org.logoUrl} name={org.name} size="sm" />
              <h3 className="text-sm font-medium text-foreground">
                {org.name} — Members ({members.length})
              </h3>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddForm(!showAddForm)}
                className={cn(
                  "p-1.5 rounded-md transition-colors",
                  showAddForm
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-accent text-muted-foreground hover:text-foreground"
                )}
                title="Add member"
              >
                <UserPlus className="h-4 w-4" strokeWidth={1.5} />
              </button>
              <button
                onClick={onClose}
                className="p-1 rounded-md hover:bg-accent transition-colors"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          {/* Add member form */}
          {showAddForm && (
            <div className="px-4 py-3 border-b border-border bg-accent/30">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                    placeholder="Search users by name or email..."
                    className="w-full pl-9 pr-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
                  />
                </div>
                <button
                  onClick={handleSearch}
                  disabled={searching || !searchQuery.trim()}
                  className={cn(
                    "px-3 py-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
                    (searching || !searchQuery.trim()) && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {searching ? "..." : "Search"}
                </button>
              </div>
              {searchResults.length > 0 && (
                <div className="mt-2 space-y-1 max-h-40 overflow-y-auto">
                  {searchResults.map((user) => (
                    <div
                      key={user.id}
                      className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent transition-colors"
                    >
                      {user.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
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
                      <button
                        onClick={() => handleAddMember(user)}
                        disabled={adding}
                        className={cn(
                          "px-2 py-1 rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
                          adding && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        Add
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
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
                      // eslint-disable-next-line @next/next/no-img-element
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
                    <button
                      onClick={() => handleRemove(member)}
                      disabled={removing === member.userId}
                      className={cn(
                        "p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors",
                        removing === member.userId && "opacity-50 cursor-not-allowed"
                      )}
                      title="Remove member"
                    >
                      <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
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

  const [rows, setRows] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

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
  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/organizations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { organizations: OrgRow[] };
      setRows(json.organizations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: setState before/after fetch is the standard React pattern
    if (isAdmin) fetchRows();
  }, [isAdmin, fetchRows]);

  // Delete org
  const handleDelete = async (org: OrgRow) => {
    const confirmed = await confirm({
      title: "Delete organization?",
      description: `This will permanently delete "${org.name}" and remove all ${org.memberCount} member(s).`,
      confirmText: "Delete",
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
        text: err instanceof Error ? err.message : "Failed to delete.",
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
        text: err instanceof Error ? err.message : "Failed to upload logo.",
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
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">
            Organizations
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage interest-based organizations. Users can join to filter
            leaderboards.
          </p>
        </div>
        <button
          onClick={() => {
            setShowCreate(!showCreate);
            setEditingId(null);
          }}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Create Organization
        </button>
      </div>

      {/* Messages */}
      {message && (
        <div
          className={cn(
            "rounded-lg p-3 text-xs",
            message.type === "success"
              ? "bg-success/10 text-success"
              : "bg-destructive/10 text-destructive"
          )}
        >
          {message.text}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load organizations: {error}
        </div>
      )}

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
        <>
          {rows.length === 0 ? (
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
                            <button
                              onClick={() => {
                                setEditingId(row.id);
                                setShowCreate(false);
                              }}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              title="Edit"
                            >
                              <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                            <button
                              onClick={() => setMembersOrg(row)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                              title="View members"
                            >
                              <Users className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                            <button
                              onClick={() => handleDelete(row)}
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
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
