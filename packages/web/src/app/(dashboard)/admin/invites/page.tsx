"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Copy, Check, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";
import { RowListSkeleton } from "@/components/ui/row-list-skeleton";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";
import type { InviteCodeRow } from "@/lib/rpc-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type StatusFilter = "all" | "available";

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function InvitesSkeleton() {
  return (
    <RowListSkeleton
      rows={5}
      middle={["w-24", "w-16"]}
      tail={["w-32"]}
    />
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

function StatusBadge({ usedBy }: { usedBy: string | null }) {
  if (!usedBy) {
    return (
      <span className="rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
        unused
      </span>
    );
  }
  if (usedBy.startsWith("pending:")) {
    return (
      <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
        pending
      </span>
    );
  }
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      used
    </span>
  );
}

// ---------------------------------------------------------------------------
// Copy button
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
      className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
      title="Copy code"
    >
      {copied ? (
        <Check className="h-3 w-3 text-success" strokeWidth={1.5} />
      ) : (
        <Copy className="h-3 w-3" strokeWidth={1.5} />
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AdminInvitesPage() {
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();

  const [rows, setRows] = useState<InviteCodeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  // Require invite code toggle
  const [requireInvite, setRequireInvite] = useState(true);
  const [requireInviteLoading, setRequireInviteLoading] = useState(true);
  const [togglingRequireInvite, setTogglingRequireInvite] = useState(false);

  // Filter
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  // Generation
  const [showGenerate, setShowGenerate] = useState(false);
  const [genCount, setGenCount] = useState(1);
  const [generating, setGenerating] = useState(false);

  // Copy all available
  const [copiedAll, setCopiedAll] = useState(false);
  const { confirm, dialogProps } = useConfirm();

  // Derived: available codes + filtered rows
  const availableCodes = useMemo(
    () => rows.filter((r) => !r.used_by),
    [rows]
  );
  const filteredRows = useMemo(
    () => (statusFilter === "available" ? availableCodes : rows),
    [statusFilter, availableCodes, rows]
  );

  // ---------------------------------------------------------------------------
  // Redirect non-admins
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/");
    }
  }, [adminLoading, isAdmin, router]);

  // ---------------------------------------------------------------------------
  // Fetch rows
  // ---------------------------------------------------------------------------

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/invites");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as { rows: InviteCodeRow[] };
      setRows(json.rows);
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

  // ---------------------------------------------------------------------------
  // Fetch require_invite_code setting
  // ---------------------------------------------------------------------------

  const fetchRequireInvite = useCallback(async () => {
    setRequireInviteLoading(true);
    try {
      const res = await fetch("/api/admin/settings");
      if (res.ok) {
        const json = (await res.json()) as {
          settings: Array<{ key: string; value: string }>;
        };
        const setting = json.settings.find((s) => s.key === "require_invite_code");
        setRequireInvite(setting?.value !== "false");
      }
    } catch {
      // Silently fail, default to true
    } finally {
      setRequireInviteLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: setState before/after fetch is the standard React pattern
    if (isAdmin) fetchRequireInvite();
  }, [isAdmin, fetchRequireInvite]);

  // ---------------------------------------------------------------------------
  // Toggle require_invite_code
  // ---------------------------------------------------------------------------

  const handleToggleRequireInvite = async () => {
    const newValue = !requireInvite;
    setTogglingRequireInvite(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: "require_invite_code",
          value: newValue ? "true" : "false",
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      setRequireInvite(newValue);
      setMessage({
        type: "success",
        text: newValue
          ? "Invite code is now required for registration."
          : "Invite code is no longer required. Anyone can register.",
      });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to update setting.",
      });
    } finally {
      setTogglingRequireInvite(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Generate
  // ---------------------------------------------------------------------------

  const handleGenerate = async () => {
    setGenerating(true);
    setMessage(null);

    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: genCount }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }

      const json = (await res.json()) as { codes: string[] };
      setMessage({
        type: "success",
        text: `Generated ${json.codes.length} invite code${json.codes.length > 1 ? "s" : ""}: ${json.codes.join(", ")}`,
      });
      setShowGenerate(false);
      setGenCount(1);
      fetchRows();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to generate.",
      });
    } finally {
      setGenerating(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = async (id: number, isPending: boolean) => {
    const confirmed = await confirm({
      title: isPending ? "Reclaim burned invite?" : "Delete invite code?",
      description: isPending
        ? "This will reclaim the burned invite code, making it available for use again."
        : "This invite code will be permanently deleted.",
      confirmText: isPending ? "Reclaim" : "Delete",
      variant: isPending ? "default" : "destructive",
    });
    if (!confirmed) return;
    setMessage(null);

    try {
      const res = await fetch(`/api/admin/invites?id=${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(
          (data as { error?: string }).error ?? `HTTP ${res.status}`
        );
      }
      setMessage({
        type: "success",
        text: isPending ? "Burned invite code reclaimed." : "Invite code deleted.",
      });
      fetchRows();
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to delete.",
      });
    }
  };

  // ---------------------------------------------------------------------------
  // Guard: loading or not admin
  // ---------------------------------------------------------------------------

  if (adminLoading) {
    return (
      <div className="space-y-4 md:space-y-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80 mt-2" />
        </div>
        <InvitesSkeleton />
      </div>
    );
  }

  if (!isAdmin) return null;

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const isDeletable = (row: InviteCodeRow) =>
    !row.used_by || row.used_by.startsWith("pending:");

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Invite Codes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage single-use invite codes for new user registration.
          </p>
        </div>
        <button
          onClick={() => setShowGenerate(!showGenerate)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors shrink-0"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Generate Codes
        </button>
      </div>

      {/* Require invite code toggle */}
      <div className="rounded-xl bg-secondary p-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={requireInvite}
            disabled={requireInviteLoading || togglingRequireInvite}
            onClick={handleToggleRequireInvite}
            className={cn(
              "relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
              requireInvite ? "bg-primary" : "bg-border",
              (requireInviteLoading || togglingRequireInvite) && "opacity-50 cursor-not-allowed",
            )}
          >
            <span
              className={cn(
                "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-sm ring-0 transition-transform",
                requireInvite ? "translate-x-4" : "translate-x-0",
              )}
            />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">
              Require invite code for registration
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {requireInvite
                ? "New users must enter a valid invite code to register."
                : "Anyone can register without an invite code."}
            </p>
          </div>
        </div>
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
          Failed to load invite codes: {error}
        </div>
      )}

      {/* Generate form */}
      {showGenerate && (
        <div className="rounded-xl bg-secondary p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">
            Generate Invite Codes
          </h3>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Count (1-20)
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={genCount}
                onChange={(e) =>
                  setGenCount(
                    Math.max(1, Math.min(20, parseInt(e.target.value) || 1))
                  )
                }
                className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground tabular-nums focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
              />
            </div>
            <button
              onClick={handleGenerate}
              disabled={generating}
              className={cn(
                "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
                generating && "opacity-50 cursor-not-allowed"
              )}
            >
              {generating ? "Generating..." : "Generate"}
            </button>
            <button
              onClick={() => {
                setShowGenerate(false);
                setGenCount(1);
              }}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Toolbar: segment filter + copy available */}
      {!loading && rows.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
            {(["all", "available"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setStatusFilter(opt)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                  statusFilter === opt
                    ? "bg-secondary text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt === "all"
                  ? `All (${rows.length})`
                  : `Available (${availableCodes.length})`}
              </button>
            ))}
          </div>
          {availableCodes.length > 0 && (
            <button
              onClick={async () => {
                const md = availableCodes.map((r) => `- ${r.code}`).join("\n");
                await navigator.clipboard.writeText(md);
                setCopiedAll(true);
                setTimeout(() => setCopiedAll(false), 2000);
              }}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Copy all available codes as Markdown list"
            >
              {copiedAll ? (
                <Check className="h-3 w-3 text-success" strokeWidth={1.5} />
              ) : (
                <ClipboardList className="h-3 w-3" strokeWidth={1.5} />
              )}
              {copiedAll ? "Copied!" : "Copy Available"}
            </button>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && <InvitesSkeleton />}

      {/* Table */}
      {!loading && (
        <>
          {filteredRows.length === 0 ? (
            <div className="rounded-card bg-secondary p-8 text-center text-sm text-muted-foreground">
              {statusFilter === "available"
                ? "No available invite codes."
                : "No invite codes yet. Generate some to get started."}
            </div>
          ) : (
            <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Code
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
                      Used By
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">
                      Created By
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden lg:table-cell">
                      Created At
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-20">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm font-mono font-medium text-foreground">
                            {row.code}
                          </span>
                          <CopyButton text={row.code} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge usedBy={row.used_by} />
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {row.used_by_email ??
                            (row.used_by?.startsWith("pending:")
                              ? row.used_by
                              : row.used_by ?? "\u2014")}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className="text-sm text-muted-foreground">
                          {row.created_by_email ?? row.created_by}
                        </span>
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        <span className="text-xs text-muted-foreground">
                          {formatDate(row.created_at)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end">
                          {isDeletable(row) && (
                            <button
                              onClick={() =>
                                handleDelete(
                                  row.id,
                                  row.used_by?.startsWith("pending:") ?? false
                                )
                              }
                              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              title={
                                row.used_by?.startsWith("pending:")
                                  ? "Reclaim burned code"
                                  : "Delete"
                              }
                            >
                              <Trash2
                                className="h-3.5 w-3.5"
                                strokeWidth={1.5}
                              />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
