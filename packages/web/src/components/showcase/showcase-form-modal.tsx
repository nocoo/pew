/**
 * Modal for adding or editing a showcase.
 */

"use client";

import { useState, useCallback, useEffect, useId } from "react";
import { Banner } from "@nocoo/basalt/components/banner";
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
import { Switch } from "@nocoo/basalt/components/switch";
import { ExternalLink, AlertCircle, Star, GitFork, Code, Scale } from "lucide-react";
import { ShowcaseImage } from "./showcase-image";
import { useShowcasePreview } from "@/hooks/use-showcases";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Display data for preview card (edit mode doesn't have GitHub stats)
type DisplayData = {
  repo_key: string;
  github_url: string;
  title: string;
  description: string | null;
  og_image_url: string;
  already_exists: boolean;
  // Optional GitHub stats (only present from preview fetch)
  stars?: number;
  forks?: number;
  language?: string | null;
  license?: string | null;
  topics?: string[];
  homepage?: string | null;
};

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
  const uid = useId();
  const githubUrlId = `${uid}-github-url`;
  const taglineId = `${uid}-tagline`;

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

  // Initialize / reset form when open state changes. Runs during render via
  // the "reset state on prop change" pattern rather than inside an effect.
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevEditId, setPrevEditId] = useState<string | null>(editData?.id ?? null);
  const currentEditId = editData?.id ?? null;
  if (prevOpen !== open || prevEditId !== currentEditId) {
    setPrevOpen(open);
    setPrevEditId(currentEditId);
    if (editMode && editData && open) {
      setGithubUrl(editData.github_url);
      setTagline(editData.tagline || "");
      setIsPublic(editData.is_public);
      setRefreshedData(null);
    } else if (!open) {
      setGithubUrl("");
      setTagline("");
      setIsPublic(true);
      setSubmitError(null);
      resetPreview();
      setRefreshedData(null);
    }
  }

  // Invalidate preview when URL changes after successful preview (add mode only)
  useEffect(() => {
    if (!editMode && preview && preview.github_url !== githubUrl.trim()) {
      resetPreview();
    }
  }, [editMode, preview, githubUrl, resetPreview]);

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
  const displayData: DisplayData | null = editMode && editData
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
          <DialogHeader>
            <DialogTitle className="text-xl">
              {editMode ? "Edit Showcase" : "Add Showcase"}
            </DialogTitle>
            <DialogDescription className="text-sm">
              {editMode
                ? "Update your showcase details."
                : "Share a GitHub repository with the community."}
            </DialogDescription>
          </DialogHeader>

          {submitError ? (
            <Banner
              variant="error"
              size="sm"
              className="mb-4"
              icon={<AlertCircle strokeWidth={1.5} />}
              description={submitError}
            />
          ) : null}

          {/* GitHub URL input (add mode only) */}
          {!editMode && (
            <div className="mb-4">
              <Field label="GitHub Repository URL" htmlFor={githubUrlId}>
                <div className="flex gap-2">
                  <Input
                    id={githubUrlId}
                    type="url"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/owner/repo"
                    className="flex-1"
                    disabled={submitting}
                  />
                  <Button
                    variant="outline"
                    onClick={handlePreview}
                    disabled={!githubUrl.trim() || previewLoading || submitting}
                    loading={previewLoading}
                  >
                    Preview
                  </Button>
                </div>
              </Field>
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

                  {/* GitHub stats badges */}
                  {displayData.stars !== undefined && (
                    <div className="flex flex-wrap items-center gap-1.5 mt-2">
                      {displayData.stars > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                          <Star className="h-2.5 w-2.5" />
                          {formatCount(displayData.stars)}
                        </span>
                      )}
                      {displayData.forks !== undefined && displayData.forks > 0 && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400">
                          <GitFork className="h-2.5 w-2.5" />
                          {formatCount(displayData.forks)}
                        </span>
                      )}
                      {displayData.language && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-600 dark:text-purple-400">
                          <Code className="h-2.5 w-2.5" />
                          {displayData.language}
                        </span>
                      )}
                      {displayData.license && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[10px] font-medium text-green-600 dark:text-green-400">
                          <Scale className="h-2.5 w-2.5" />
                          {displayData.license}
                        </span>
                      )}
                    </div>
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
                  <Button
                    variant="link"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={refreshing || submitting}
                    loading={refreshing}
                  >
                    Refresh from GitHub
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Tagline input */}
          {(editMode || displayData) && (
            <Field
              className="mb-4"
              label="Your Recommendation"
              htmlFor={taglineId}
              required={false}
              hint={`${tagline.length}/280`}
            >
              <InputArea
                id={taglineId}
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="Why do you recommend this project?"
                maxLength={280}
                rows={2}
                disabled={submitting}
              />
            </Field>
          )}

          {/* Visibility toggle (edit mode) */}
          {editMode && (
            <div className="mb-5 flex items-center justify-between">
              <div>
                <span className="block text-xs font-medium text-foreground">
                  Public
                </span>
                <p className="text-[10px] text-muted-foreground">
                  Show this showcase on the public leaderboard.
                </p>
              </div>
              <Switch
                checked={isPublic}
                onCheckedChange={setIsPublic}
                disabled={submitting}
                size="sm"
                aria-label="Public"
              />
            </div>
          )}

          {/* Actions */}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={submitting}>
                Cancel
              </Button>
            </DialogClose>
            <Button
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={submitting}
            >
              {editMode ? "Save Changes" : "Add Showcase"}
            </Button>
          </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
