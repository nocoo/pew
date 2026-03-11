"use client";

import { useState, useEffect, useCallback } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectAlias {
  source: string;
  project_ref: string;
}

export interface Project {
  id: string;
  name: string;
  aliases: ProjectAlias[];
  session_count: number;
  last_active: string | null;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

interface UseProjectsResult {
  data: ProjectsData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  createProject: (
    name: string,
    aliases?: ProjectAlias[],
  ) => Promise<Project | null>;
  updateProject: (
    id: string,
    updates: {
      name?: string;
      add_aliases?: ProjectAlias[];
      remove_aliases?: ProjectAlias[];
    },
  ) => Promise<Project | null>;
  deleteProject: (id: string) => Promise<boolean>;
}

export function useProjects(): UseProjectsResult {
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
      const res = await fetch("/api/projects");
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
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ---------------------------------------------------------------------------
  // Mutations
  // ---------------------------------------------------------------------------

  const createProject = useCallback(
    async (
      name: string,
      aliases?: ProjectAlias[],
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
        add_aliases?: ProjectAlias[];
        remove_aliases?: ProjectAlias[];
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
    loading,
    error,
    refetch: fetchData,
    createProject,
    updateProject,
    deleteProject,
  };
}
