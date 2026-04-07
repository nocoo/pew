/**
 * Modal for adding or editing a showcase.
 */

"use client";

import { useState, useCallback, useEffect } from "react";
import { Dialog } from "radix-ui";
import { X, Loader2, ExternalLink, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ShowcaseImage } from "./showcase-image";
import { useShowcasePreview, type ShowcasePreview } from "@/hooks/use-showcases";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShowcaseFormModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  // For edit mode
  editMode?: boolean;
  editData?: {
    id: string;
    repo_key: string;
    github_url: string;
    title: string;
    description: string | null;
    og_image_url: string | null;
    tagline: string | null;
    is_public: boolean;
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ShowcaseFormModal({
  open,
  onOpenChange,
  onSuccess,
  editMode = false,
  editData,
}: ShowcaseFormModalProps) {
  // Form state
  const [githubUrl, setGithubUrl] = useState("");
  const [tagline, setTagline] = useState("");
  const [isPublic, setIsPublic] = useState(true);

  // Preview state (for add mode)
  const { preview, loading: previewLoading, error: previewError, fetchPreview, reset: resetPreview } = useShowcasePreview();

  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Refresh state (for edit mode)
  const [refreshing, setRefreshing] = useState(false);
  const [refreshedData, setRefreshedData] = useState<{
    title: string;
    description: string | null;
    og_image_url: string;
  } | null>(null);

  // Initialize form for edit mode
  useEffect(() => {
    if (editMode && editData && open) {
      setGithubUrl(editData.github_url);
      setTagline(editData.tagline || "");
      setIsPublic(editData.is_public);
      setRefreshedData(null);
    } else if (!open) {
      // Reset on close
      setGithubUrl("");
      setTagline("");
      setIsPublic(true);
      setSubmitError(null);
      resetPreview();
      setRefreshedData(null);
    }
  }, [editMode, editData, open, resetPreview]);

  // Handle preview fetch
  const handlePreview = useCallback(async () => {
    if (!githubUrl.trim()) return;
    await fetchPreview(githubUrl.trim());
  }, [githubUrl, fetchPreview]);

  // Handle refresh from GitHub (edit mode)
  const handleRefresh = useCallback(async () => {
    if (!editData) return;
    setRefreshing(true);
    setSubmitError(null);

    try {
      const res = await fetch(`/api/showcases/${editData.id}/refresh`, {
        method: "POST",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }

      const data = await res.json();
      setRefreshedData({
        title: data.title,
        description: data.description,
        og_image_url: data.og_image_url,
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to refresh");
    } finally {
      setRefreshing(false);
    }
  }, [editData]);

  // Handle submit
  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      if (editMode && editData) {
        // Update showcase
        const res = await fetch(`/api/showcases/${editData.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tagline: tagline.trim() || null,
            is_public: isPublic,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
      } else {
        // Create showcase
        const res = await fetch("/api/showcases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            github_url: githubUrl.trim(),
            tagline: tagline.trim() || undefined,
          }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
        }
      }

      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSubmitting(false);
    }
  }, [editMode, editData, githubUrl, tagline, isPublic, onSuccess, onOpenChange]);

  // Computed display data
  const displayData: ShowcasePreview | null = editMode && editData
    ? {
        repo_key: editData.repo_key,
        github_url: editData.github_url,
        title: refreshedData?.title ?? editData.title,
        description: refreshedData?.description ?? editData.description,
        og_image_url: refreshedData?.og_image_url ?? editData.og_image_url ?? "",
        already_exists: false,
      }
    : preview;

  const canSubmit = editMode
    ? !submitting && !refreshing
    : !submitting && preview && !preview.already_exists;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg max-h-[90vh] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl bg-card p-6 shadow-lg data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95">
          {/* Close button */}
          <Dialog.Close asChild>
            <button className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>

          {/* Title */}
          <Dialog.Title className="text-xl font-semibold text-foreground mb-1">
            {editMode ? "Edit Showcase" : "Add Showcase"}
          </Dialog.Title>
          <Dialog.Description className="text-sm text-muted-foreground mb-5">
            {editMode
              ? "Update your showcase details."
              : "Share a GitHub repository with the community."}
          </Dialog.Description>

          {/* Error */}
          {submitError && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive mb-4 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{submitError}</span>
            </div>
          )}

          {/* GitHub URL input (add mode only) */}
          {!editMode && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                GitHub Repository URL
              </label>
              <div className="flex gap-2">
                <input
                  type="url"
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
                  disabled={submitting}
                />
                <button
                  onClick={handlePreview}
                  disabled={!githubUrl.trim() || previewLoading || submitting}
                  className={cn(
                    "rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors",
                    previewLoading
                      ? "opacity-50 cursor-not-allowed"
                      : "hover:bg-accent hover:text-foreground"
                  )}
                >
                  {previewLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Preview"
                  )}
                </button>
              </div>
              {previewError && (
                <p className="mt-1.5 text-xs text-destructive">{previewError}</p>
              )}
            </div>
          )}

          {/* Preview card */}
          {displayData && (
            <div className="rounded-lg border border-border bg-background p-4 mb-4">
              <div className="flex gap-4">
                {/* Image */}
                <div className="shrink-0 w-[120px] aspect-[1.91/1] rounded-lg overflow-hidden bg-accent/50">
                  <ShowcaseImage
                    url={displayData.og_image_url}
                    repoKey={displayData.repo_key}
                    className="w-full h-full"
                  />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <a
                    href={displayData.github_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 group"
                  >
                    <h4 className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                      {displayData.title}
                    </h4>
                    <ExternalLink className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </a>
                  <p className="text-xs text-muted-foreground font-mono mt-0.5">
                    {displayData.repo_key}
                  </p>
                  {displayData.description && (
                    <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">
                      {displayData.description}
                    </p>
                  )}
                </div>
              </div>

              {/* Already exists warning */}
              {!editMode && displayData.already_exists && (
                <div className="mt-3 rounded-md bg-warning/10 px-3 py-2 text-xs text-warning flex items-center gap-2">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  This repository has already been showcased.
                </div>
              )}

              {/* Refresh button (edit mode) */}
              {editMode && (
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-[10px] text-muted-foreground">
                    Title and description are synced from GitHub.
                  </p>
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing || submitting}
                    className={cn(
                      "text-xs text-primary hover:text-primary/80 transition-colors",
                      (refreshing || submitting) && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    {refreshing ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Refreshing...
                      </span>
                    ) : (
                      "Refresh from GitHub"
                    )}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Tagline input */}
          {(editMode || displayData) && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                Your Recommendation (optional)
              </label>
              <textarea
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Why do you recommend this project?"
                maxLength={280}
                rows={2}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow resize-none"
                disabled={submitting}
              />
              <p className="mt-1 text-right text-[10px] text-muted-foreground">
                {tagline.length}/280
              </p>
            </div>
          )}

          {/* Visibility toggle (edit mode) */}
          {editMode && (
            <div className="mb-5 flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-foreground">
                  Public
                </label>
                <p className="text-[10px] text-muted-foreground">
                  Show this showcase on the public leaderboard.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isPublic}
                onClick={() => setIsPublic(!isPublic)}
                disabled={submitting}
                className={cn(
                  "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors",
                  isPublic ? "bg-primary" : "bg-border",
                  submitting && "opacity-50 cursor-not-allowed"
                )}
              >
                <span
                  className={cn(
                    "pointer-events-none inline-block h-4 w-4 transform rounded-full bg-background shadow-sm ring-0 transition-transform",
                    isPublic ? "translate-x-4" : "translate-x-0"
                  )}
                />
              </button>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <button
                disabled={submitting}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className={cn(
                "flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors",
                !canSubmit && "opacity-50 cursor-not-allowed"
              )}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editMode ? "Save Changes" : "Add Showcase"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
