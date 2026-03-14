"use client";

import { useState, useEffect, useCallback, useMemo } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectAliasInput {
  source: string;
  project_ref: string;
}

export interface ProjectAlias extends ProjectAliasInput {
  session_count: number;
}

export interface Project {
  id: string;
  name: string;
  aliases: ProjectAlias[];
  tags: string[];
  session_count: number;
  last_active: string | null;
  absolute_last_active: string | null;
  total_messages: number;
  total_duration: number;
  models: string[];
  created_at: string;
}

export interface UnassignedRef {
  source: string;
  project_ref: string;
  session_count: number;
  last_active: string | null;
  total_messages: number;
  total_duration: number;
  models: string[];
}

export interface ProjectsData {
  projects: Project[];
  unassigned: UnassignedRef[];
}

export interface UseProjectsOptions {
  /** Inclusive start date (YYYY-MM-DD). Both from and to must be set for date filtering. */
  from?: string;
  /** Exclusive end date (YYYY-MM-DD). Both from and to must be set for date filtering. */
  to?: string;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseProjectsResult {
  data: ProjectsData | null;
  /** All unique tags across all projects, sorted alphabetically. */
  allTags: string[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createProject: (
    name: string,
    aliases?: ProjectAliasInput[],
  ) => Promise<Project | null>;
  updateProject: (
    id: string,
    updates: {
      name?: string;
      add_aliases?: ProjectAliasInput[];
      remove_aliases?: ProjectAliasInput[];
      add_tags?: string[];
      remove_tags?: string[];
    },
  ) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<boolean>;
}

export function useProjects(options?: UseProjectsOptions): UseProjectsResult {
  const from = options?.from;
  const to = options?.to;
  const [data, setData] = useState<ProjectsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (from) {
        params.set("from", from);
        if (to) params.set("to", to);
      }
      const qs = params.toString();
      const url = qs ? `/api/projects?${qs}` : "/api/projects";
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          (body as { error?: string }).error ?? `HTTP ${res.status}`,
        );
      }

      const json = (await res.json()) as ProjectsData;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---------------------------------------------------------------------------
  // Derived: all unique tags
  // ---------------------------------------------------------------------------

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of data?.projects ?? []) {
      for (const t of p.tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [data]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createProject = useCallback(
    async (
      name: string,
      aliases?: ProjectAliasInput[],
    ): Promise<Project | null> => {
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, aliases }),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        const project = (await res.json()) as Project;
        // Refetch to get updated data (unassigned list changes)
        await fetchData();
        return project;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    },
    [fetchData],
  );

  const updateProject = useCallback(
    async (
      id: string,
      updates: {
        name?: string;
        add_aliases?: ProjectAliasInput[];
        remove_aliases?: ProjectAliasInput[];
        add_tags?: string[];
        remove_tags?: string[];
      },
    ): Promise<Project | null> => {
      try {
        const res = await fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        const project = (await res.json()) as Project;
        await fetchData();
        return project;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    },
    [fetchData],
  );

  const deleteProject = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/projects/${id}`, {
          method: "DELETE",
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            (body as { error?: string }).error ?? `HTTP ${res.status}`,
          );
        }

        await fetchData();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        return false;
      }
    },
    [fetchData],
  );

  return {
    data,
    allTags,
    loading,
    error,
    refetch: fetchData,
    createProject,
    updateProject,
    deleteProject,
  };
}
