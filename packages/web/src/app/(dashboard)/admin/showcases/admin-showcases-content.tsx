/**
 * Client component for admin showcase moderation.
 */

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Eye,
  EyeOff,
  Trash2,
  ExternalLink,
  RefreshCw,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Package,
  Users,
  Github,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ShowcaseImage } from "@/components/showcase";
import { ConfirmDialog, useConfirm } from "@/components/ui/confirm-dialog";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdminShowcase {
  id: string;
  repo_key: string;
  github_url: string;
  title: string;
  description: string | null;
  tagline: string | null;
  og_image_url: string | null;
  upvote_count: number;
  is_public: boolean;
  created_at: string;
  refreshed_at: string;
  user: {
    id: string;
    email: string;
    name: string | null;
    nickname: string | null;
    image: string | null;
    slug: string | null;
  };
}

interface AdminShowcasesResponse {
  showcases: AdminShowcase[];
  total: number;
  limit: number;
  offset: number;
  stats: {
    totalShowcases: number;
    uniqueUsers: number;
    uniqueGithubOwners: number;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

type StatusFilter = "all" | "public" | "hidden";

export function AdminShowcasesContent() {
  const [data, setData] = useState<AdminShowcasesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const { confirm, dialogProps } = useConfirm();

  // Fetch data
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(offset));
      if (statusFilter === "public") params.set("is_public", "1");
      if (statusFilter === "hidden") params.set("is_public", "0");

      const res = await fetch(`/api/admin/showcases?${params.toString()}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const json = (await res.json()) as AdminShowcasesResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [offset, statusFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Toggle visibility
  const handleToggleVisibility = useCallback(async (id: string, currentPublic: boolean) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/showcases/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: !currentPublic }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to update");
      }

      // Optimistic update
      setData((prev) =>
        prev
          ? {
              ...prev,
              showcases: prev.showcases.map((s) =>
                s.id === id ? { ...s, is_public: !currentPublic } : s
              ),
            }
          : null
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update showcase");
    } finally {
      setActionLoading(null);
    }
  }, []);

  // Delete
  const handleDelete = useCallback(async (id: string) => {
    const confirmed = await confirm({
      title: "Delete showcase?",
      description: "Are you sure you want to delete this showcase? This action cannot be undone.",
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!confirmed) return;

    setActionLoading(id);
    try {
      const res = await fetch(`/api/showcases/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to delete");
      }

      // Remove from list
      setData((prev) =>
        prev
          ? {
              ...prev,
              showcases: prev.showcases.filter((s) => s.id !== id),
              total: prev.total - 1,
            }
          : null
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete showcase");
    } finally {
      setActionLoading(null);
    }
  }, [confirm]);

  // Loading state
  if (loading && !data) {
    return (
      <div className="rounded-xl bg-secondary p-1 animate-pulse">
        <div className="h-64" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-xl bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load showcases: {error}
      </div>
    );
  }

  const showcases = data?.showcases ?? [];
  const total = data?.total ?? 0;
  const stats = data?.stats ?? { totalShowcases: 0, uniqueUsers: 0, uniqueGithubOwners: 0 };
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-center gap-3 rounded-xl bg-secondary p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <Package className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{stats.totalShowcases}</p>
            <p className="text-xs text-muted-foreground">Total Showcases</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-secondary p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-chart-2">
            <Users className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{stats.uniqueUsers}</p>
            <p className="text-xs text-muted-foreground">Pew Users</p>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-secondary p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-chart-7">
            <Github className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{stats.uniqueGithubOwners}</p>
            <p className="text-xs text-muted-foreground">GitHub Owners</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {/* Status filter */}
          <div className="flex items-center gap-1 rounded-lg bg-secondary p-1">
            {(["all", "public", "hidden"] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => {
                  setStatusFilter(opt);
                  setOffset(0);
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize",
                  statusFilter === opt
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {opt}
              </button>
            ))}
          </div>

          <span className="text-sm text-muted-foreground ml-2">
            {total} {total === 1 ? "showcase" : "showcases"}
          </span>
        </div>

        <button
          onClick={() => fetchData()}
          disabled={loading}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors",
            loading && "animate-spin"
          )}
          title="Refresh"
        >
          <RefreshCw className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      {/* Table */}
      {showcases.length === 0 ? (
        <div className="rounded-xl bg-secondary p-8 text-center">
          <p className="text-muted-foreground">No showcases found.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">
                  Showcase
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground hidden md:table-cell">
                  Submitter
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground w-20">
                  Upvotes
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-muted-foreground w-24">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground w-24">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {showcases.map((showcase) => {
                const displayName = showcase.user.nickname || showcase.user.name || "Anonymous";
                const isLoading = actionLoading === showcase.id;

                return (
                  <tr
                    key={showcase.id}
                    className={cn(
                      "border-b border-border/50 last:border-0 hover:bg-accent/50 transition-colors",
                      isLoading && "opacity-50"
                    )}
                  >
                    {/* Showcase info */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="shrink-0 w-12 aspect-[1.91/1] rounded-md overflow-hidden bg-accent/50">
                          <ShowcaseImage
                            url={showcase.og_image_url}
                            repoKey={showcase.repo_key}
                            className="w-full h-full"
                          />
                        </div>
                        <div className="min-w-0">
                          <a
                            href={showcase.github_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center gap-1.5"
                          >
                            <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
                              {showcase.title}
                            </span>
                            <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                          </a>
                          <p className="text-[10px] text-muted-foreground font-mono">
                            {showcase.repo_key}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Submitter */}
                    <td className="px-4 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-2">
                        {showcase.user.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={showcase.user.image}
                            alt={displayName}
                            className="h-6 w-6 rounded-full"
                          />
                        ) : (
                          <div className="h-6 w-6 rounded-full bg-accent flex items-center justify-center">
                            <span className="text-[10px] font-medium text-muted-foreground">
                              {displayName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-foreground truncate">
                            {displayName}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate">
                            {showcase.user.email}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Upvotes */}
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-0.5 text-sm text-muted-foreground tabular-nums">
                        <ChevronUp className="h-3.5 w-3.5" />
                        {showcase.upvote_count}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3 text-center">
                      {showcase.is_public ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                          <Eye className="h-2.5 w-2.5" />
                          Public
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                          <EyeOff className="h-2.5 w-2.5" />
                          Hidden
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => handleToggleVisibility(showcase.id, showcase.is_public)}
                          disabled={isLoading}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                          title={showcase.is_public ? "Hide" : "Show"}
                        >
                          {showcase.is_public ? (
                            <EyeOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                          ) : (
                            <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
                          )}
                        </button>
                        <button
                          onClick={() => handleDelete(showcase.id)}
                          disabled={isLoading}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0 || loading}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-border transition-colors",
              offset === 0 || loading
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-accent hover:text-foreground"
            )}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="text-sm text-muted-foreground tabular-nums px-2">
            Page {currentPage} of {totalPages}
          </span>

          <button
            onClick={() => setOffset(offset + PAGE_SIZE)}
            disabled={currentPage >= totalPages || loading}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md border border-border transition-colors",
              currentPage >= totalPages || loading
                ? "opacity-50 cursor-not-allowed"
                : "hover:bg-accent hover:text-foreground"
            )}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Confirm dialog */}
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
