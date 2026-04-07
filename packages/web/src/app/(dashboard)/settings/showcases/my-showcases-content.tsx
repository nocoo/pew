/**
 * Client component for managing user's own showcases.
 */

"use client";

import { useState, useCallback } from "react";
import { Plus, Pencil, Trash2, Eye, EyeOff, ExternalLink, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useShowcases, type Showcase } from "@/hooks/use-showcases";
import { ShowcaseImage, ShowcaseFormModal } from "@/components/showcase";

export function MyShowcasesContent() {
  const { data, loading, error, refetch } = useShowcases({ mine: true });
  const [showAddModal, setShowAddModal] = useState(false);
  const [editShowcase, setEditShowcase] = useState<Showcase | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  const handleDelete = useCallback(async (id: string) => {
    if (!confirm("Are you sure you want to delete this showcase?")) return;

    setDeleting(id);
    try {
      const res = await fetch(`/api/showcases/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to delete");
      }
      refetch();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete showcase");
    } finally {
      setDeleting(null);
    }
  }, [refetch]);

  const handleSuccess = useCallback(() => {
    refetch();
    setEditShowcase(null);
  }, [refetch]);

  // Loading state
  if (loading) {
    return (
      <div className="space-y-3 animate-pulse">
        {[1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-secondary" />
        ))}
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

  return (
    <div className="space-y-4">
      {/* Add button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" strokeWidth={1.5} />
          Add Showcase
        </button>
      </div>

      {/* Empty state */}
      {showcases.length === 0 && (
        <div className="rounded-xl bg-secondary p-8 text-center">
          <p className="text-muted-foreground">
            You haven&apos;t submitted any showcases yet.
          </p>
          <button
            onClick={() => setShowAddModal(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Add Your First Showcase
          </button>
        </div>
      )}

      {/* Showcase list */}
      <div className="space-y-3">
        {showcases.map((showcase) => (
          <div
            key={showcase.id}
            className={cn(
              "flex items-center gap-4 rounded-xl bg-secondary p-4 transition-opacity",
              deleting === showcase.id && "opacity-50"
            )}
          >
            {/* Thumbnail */}
            <div className="shrink-0 w-20 aspect-[1.91/1] rounded-lg overflow-hidden bg-accent/50">
              <ShowcaseImage
                url={showcase.og_image_url}
                repoKey={showcase.repo_key}
                className="w-full h-full"
              />
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <a
                  href={showcase.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-1.5"
                >
                  <h3 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                    {showcase.title}
                  </h3>
                  <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </a>

                {/* Visibility badge */}
                {showcase.is_public ? (
                  <span className="flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
                    <Eye className="h-2.5 w-2.5" />
                    Public
                  </span>
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                    <EyeOff className="h-2.5 w-2.5" />
                    Hidden
                  </span>
                )}
              </div>

              {showcase.tagline && (
                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                  &ldquo;{showcase.tagline}&rdquo;
                </p>
              )}

              <div className="flex items-center gap-3 mt-1">
                <span className="text-[10px] text-muted-foreground font-mono">
                  {showcase.repo_key}
                </span>
                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                  <ChevronUp className="h-3 w-3" />
                  {showcase.upvote_count}
                </span>
              </div>
            </div>

            {/* Actions */}
            <div className="shrink-0 flex items-center gap-1">
              <button
                onClick={() => setEditShowcase(showcase)}
                disabled={deleting === showcase.id}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50"
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
              <button
                onClick={() => handleDelete(showcase.id)}
                disabled={deleting === showcase.id}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add modal */}
      <ShowcaseFormModal
        open={showAddModal}
        onOpenChange={setShowAddModal}
        onSuccess={handleSuccess}
      />

      {/* Edit modal */}
      {editShowcase && (
        <ShowcaseFormModal
          open={true}
          onOpenChange={(open) => !open && setEditShowcase(null)}
          onSuccess={handleSuccess}
          editMode
          editData={{
            id: editShowcase.id,
            repo_key: editShowcase.repo_key,
            github_url: editShowcase.github_url,
            title: editShowcase.title,
            description: editShowcase.description,
            og_image_url: editShowcase.og_image_url,
            tagline: editShowcase.tagline,
            is_public: editShowcase.is_public,
          }}
        />
      )}
    </div>
  );
}
