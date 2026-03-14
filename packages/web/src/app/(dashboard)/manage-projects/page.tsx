"use client";

import { useState } from "react";
import {
  FolderKanban,
  Plus,
  Trash2,
  X,
  ChevronDown,
  LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { formatDuration } from "@/lib/date-helpers";
import { sourceLabel } from "@/hooks/use-usage-data";
import { agentColor, withAlpha } from "@/lib/palette";
import {
  useProjects,
  type Project,
  type ProjectAlias,
  type UnassignedRef,
} from "@/hooks/use-projects";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------------------------------------------------------------------------
// Create Project Dialog (inline)
// ---------------------------------------------------------------------------

function CreateProjectForm({
  onCreated,
  onCancel,
  initialAlias,
}: {
  onCreated: (name: string, aliases?: ProjectAlias[]) => Promise<void>;
  onCancel: () => void;
  initialAlias?: ProjectAlias;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    await onCreated(name.trim(), initialAlias ? [initialAlias] : undefined);
    setSaving(false);
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        maxLength={100}
        autoFocus
        className="flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring/20 transition-shadow"
      />
      <button
        type="submit"
        disabled={saving || !name.trim()}
        className={cn(
          "rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90",
          (saving || !name.trim()) && "opacity-50 cursor-not-allowed",
        )}
      >
        {saving ? "Creating…" : "Create"}
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Assign Dropdown
// ---------------------------------------------------------------------------

function AssignDropdown({
  projects,
  onAssignExisting,
  onCreateNew,
  onClose,
}: {
  projects: Project[];
  onAssignExisting: (projectId: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-lg border border-border bg-background shadow-lg">
      <div className="p-1">
        {projects.length > 0 && (
          <>
            <p className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
              Existing projects
            </p>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onAssignExisting(p.id);
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
              >
                <FolderKanban className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                <span className="truncate">{p.name}</span>
              </button>
            ))}
            <Separator className="my-1" />
          </>
        )}
        <button
          onClick={() => {
            onCreateNew();
            onClose();
          }}
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
        >
          <Plus className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
          <span>Create new project</span>
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project Card
// ---------------------------------------------------------------------------

function ProjectCard({
  project,
  onDelete,
  onRemoveAlias,
  onRename,
}: {
  project: Project;
  onDelete: () => void;
  onRemoveAlias: (alias: ProjectAlias) => void;
  onRename: (newName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(project.name);
  const [confirming, setConfirming] = useState(false);

  const handleRename = () => {
    if (editName.trim() && editName.trim() !== project.name) {
      onRename(editName.trim());
    }
    setEditing(false);
  };

  return (
    <div className="rounded-xl bg-secondary p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleRename();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                maxLength={100}
                autoFocus
                onBlur={handleRename}
                className="flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring/20"
              />
            </form>
          ) : (
            <button
              onClick={() => {
                setEditName(project.name);
                setEditing(true);
              }}
              className="text-sm font-medium text-foreground hover:text-foreground/80 transition-colors text-left"
              title="Click to rename"
            >
              {project.name}
            </button>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
            <span>
              {project.session_count}{" "}
              {project.session_count === 1 ? "session" : "sessions"}
            </span>
            <span className="hidden sm:inline">·</span>
            <span className="hidden sm:inline">
              {project.total_messages.toLocaleString()} msgs
            </span>
            <span className="hidden md:inline">·</span>
            <span className="hidden md:inline">
              {formatDuration(project.total_duration)}
            </span>
            <span>·</span>
            <span>{relativeTime(project.last_active)}</span>
            {project.models.length > 0 && (
              <>
                <span className="hidden lg:inline">·</span>
                <span className="hidden lg:inline truncate max-w-xs">
                  {project.models.join(", ")}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Delete */}
        {confirming ? (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                onDelete();
                setConfirming(false);
              }}
              className="rounded-md bg-destructive px-2 py-1 text-[11px] font-medium text-destructive-foreground hover:bg-destructive/90 transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="rounded-md p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="Delete project"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
        )}
      </div>

      {/* Aliases */}
      {project.aliases.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {project.aliases.map((alias) => (
            <span
              key={`${alias.source}:${alias.project_ref}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[11px]"
            >
              <span
                className="rounded px-1 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: withAlpha(agentColor(alias.source).token, 0.12),
                  color: agentColor(alias.source).color,
                }}
              >
                {sourceLabel(alias.source)}
              </span>
              <code className="font-mono text-foreground break-all">
                {alias.project_ref}
              </code>
              <button
                onClick={() => onRemoveAlias(alias)}
                className="ml-0.5 text-muted-foreground/50 hover:text-destructive transition-colors"
                title="Remove alias"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground/70 italic">
          (no aliases) — assign references from the table below
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Responsive table header/cell class helpers
// ---------------------------------------------------------------------------

const TH_BASE =
  "px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground/70";

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function ProjectsPage() {
  const {
    data,
    loading,
    error,
    createProject,
    updateProject,
    deleteProject,
  } = useProjects();

  const [showCreate, setShowCreate] = useState(false);
  const [createForAlias, setCreateForAlias] = useState<ProjectAlias | null>(
    null,
  );
  const [openDropdownKey, setOpenDropdownKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleCreate = async (name: string, aliases?: ProjectAlias[]) => {
    setActionError(null);
    const result = await createProject(name, aliases);
    if (result) {
      setShowCreate(false);
      setCreateForAlias(null);
    }
  };

  const handleAssignToExisting = async (
    projectId: string,
    ref: UnassignedRef,
  ) => {
    setActionError(null);
    const result = await updateProject(projectId, {
      add_aliases: [{ source: ref.source, project_ref: ref.project_ref }],
    });
    if (!result) {
      setActionError(
        `Failed to assign ${sourceLabel(ref.source)}:${ref.project_ref}`,
      );
    }
  };

  const handleRemoveAlias = async (projectId: string, alias: ProjectAlias) => {
    setActionError(null);
    await updateProject(projectId, { remove_aliases: [alias] });
  };

  const handleRename = async (projectId: string, newName: string) => {
    setActionError(null);
    await updateProject(projectId, { name: newName });
  };

  const handleDelete = async (projectId: string) => {
    setActionError(null);
    await deleteProject(projectId);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Loading project data…
          </p>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-24 rounded-xl bg-secondary animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  const projects = data?.projects ?? [];
  const unassigned = data?.unassigned ?? [];
  const hasNoData = projects.length === 0 && unassigned.length === 0;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Projects</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Group anonymous project references from different AI tools into
          named projects.
        </p>
      </div>

      {/* Errors */}
      {(error || actionError) && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error || actionError}
        </div>
      )}

      {/* Empty state */}
      {hasNoData && (
        <div className="rounded-xl bg-secondary p-8 text-center">
          <FolderKanban
            className="mx-auto h-10 w-10 text-muted-foreground/40"
            strokeWidth={1}
          />
          <p className="mt-3 text-sm text-muted-foreground">
            No projects found. Sync your AI tools to see project data.
          </p>
        </div>
      )}

      {/* Your Projects */}
      {(projects.length > 0 || showCreate) && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FolderKanban className="h-4 w-4" strokeWidth={1.5} />
              Your Projects
            </h2>
            {!showCreate && (
              <button
                onClick={() => {
                  setCreateForAlias(null);
                  setShowCreate(true);
                }}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={1.5} />
                New Project
              </button>
            )}
          </div>

          <div className="space-y-2">
            {showCreate && (
              <div className="rounded-xl bg-secondary p-4">
                <CreateProjectForm
                  onCreated={handleCreate}
                  onCancel={() => {
                    setShowCreate(false);
                    setCreateForAlias(null);
                  }}
                  {...(createForAlias ? { initialAlias: createForAlias } : {})}
                />
                {createForAlias && (
                  <p className="mt-2 text-[10px] text-muted-foreground">
                    Will assign{" "}
                    <code className="font-mono">
                      {sourceLabel(createForAlias.source)}:
                      {createForAlias.project_ref}
                    </code>{" "}
                    to this project.
                  </p>
                )}
              </div>
            )}

            {projects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onDelete={() => handleDelete(project.id)}
                onRemoveAlias={(alias) =>
                  handleRemoveAlias(project.id, alias)
                }
                onRename={(newName) => handleRename(project.id, newName)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Unassigned References */}
      {unassigned.length > 0 && (
        <>
          <Separator />
          <section>
            <h2 className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
              <LinkIcon className="h-4 w-4" strokeWidth={1.5} />
              Unassigned References
              <span className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {unassigned.length}
              </span>
            </h2>

            {projects.length === 0 && !showCreate && (
              <p className="text-xs text-muted-foreground mb-3">
                You have {unassigned.length} unassigned project reference
                {unassigned.length === 1 ? "" : "s"}. Create a project to
                organize them.
              </p>
            )}

            <div className="rounded-xl bg-secondary p-1 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50">
                    <th className={cn(TH_BASE, "text-left")}>
                      Source
                    </th>
                    <th className={cn(TH_BASE, "text-left")}>
                      Project Ref
                    </th>
                    <th className={cn(TH_BASE, "text-right")}>
                      Sessions
                    </th>
                    <th className={cn(TH_BASE, "text-right hidden sm:table-cell")}>
                      Messages
                    </th>
                    <th className={cn(TH_BASE, "text-right hidden md:table-cell")}>
                      Duration
                    </th>
                    <th className={cn(TH_BASE, "text-left hidden lg:table-cell")}>
                      Models
                    </th>
                    <th className={cn(TH_BASE, "text-right")}>
                      Last Active
                    </th>
                    <th className={cn(TH_BASE, "text-right")}>
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {unassigned.map((ref) => {
                    const key = `${ref.source}:${ref.project_ref}`;
                    return (
                      <tr
                        key={key}
                        className="border-b border-border/30 last:border-0"
                      >
                        <td className="px-4 py-2.5 whitespace-nowrap">
                          <span
                            className="inline-block rounded-md px-2 py-0.5 text-xs font-medium"
                            style={{
                              backgroundColor: withAlpha(agentColor(ref.source).token, 0.12),
                              color: agentColor(ref.source).color,
                            }}
                          >
                            {sourceLabel(ref.source)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          <code className="font-mono text-xs text-muted-foreground break-all">
                            {ref.project_ref}
                          </code>
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums whitespace-nowrap">
                          {ref.session_count}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground tabular-nums whitespace-nowrap hidden sm:table-cell">
                          {ref.total_messages.toLocaleString()}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap hidden md:table-cell">
                          {formatDuration(ref.total_duration)}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground hidden lg:table-cell">
                          <span className="text-xs truncate block max-w-[200px]">
                            {ref.models.length > 0
                              ? ref.models.join(", ")
                              : "—"}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground whitespace-nowrap">
                          {relativeTime(ref.last_active)}
                        </td>
                        <td className="px-4 py-2.5 text-right whitespace-nowrap">
                          <div className="relative inline-block">
                            <button
                              onClick={() =>
                                setOpenDropdownKey(
                                  openDropdownKey === key ? null : key,
                                )
                              }
                              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                            >
                              Assign
                              <ChevronDown
                                className="h-3 w-3"
                                strokeWidth={1.5}
                              />
                            </button>
                            {openDropdownKey === key && (
                              <AssignDropdown
                                projects={projects}
                                onAssignExisting={(projectId) =>
                                  handleAssignToExisting(projectId, ref)
                                }
                                onCreateNew={() => {
                                  setCreateForAlias({
                                    source: ref.source,
                                    project_ref: ref.project_ref,
                                  });
                                  setShowCreate(true);
                                }}
                                onClose={() => setOpenDropdownKey(null)}
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
