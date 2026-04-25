"use client";

import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import { throwApiError } from "@/lib/api-error";
import { fetcher } from "@/lib/fetcher";

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

  const url = useMemo(() => {
    const params = new URLSearchParams();
    if (from) {
      params.set("from", from);
      if (to) params.set("to", to);
    }
    const qs = params.toString();
    return qs ? `/api/projects?${qs}` : "/api/projects";
  }, [from, to]);

  const { data, error, isLoading, mutate } = useSWR<ProjectsData>(url, fetcher);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const set = new Set<string>();
    for (const p of data?.projects ?? []) {
      for (const t of p.tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [data]);

  const createProject = useCallback(
    async (
      name: string,
      aliases?: ProjectAliasInput[],
    ): Promise<Project | null> => {
      setMutationError(null);
      try {
        const res = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, aliases }),
        });
        if (!res.ok) await throwApiError(res);
        const project = (await res.json()) as Project;
        await mutate();
        return project;
      } catch (err) {
        setMutationError(err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    },
    [mutate],
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
      setMutationError(null);
      try {
        const res = await fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) await throwApiError(res);
        const project = (await res.json()) as Project;
        await mutate();
        return project;
      } catch (err) {
        setMutationError(err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    },
    [mutate],
  );

  const deleteProject = useCallback(
    async (id: string): Promise<boolean> => {
      setMutationError(null);
      try {
        const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
        if (!res.ok) await throwApiError(res);
        await mutate();
        return true;
      } catch (err) {
        setMutationError(err instanceof Error ? err.message : "Unknown error");
        return false;
      }
    },
    [mutate],
  );

  return {
    data: data ?? null,
    allTags,
    loading: isLoading,
    error:
      mutationError ??
      (error ? (error instanceof Error ? error.message : String(error)) : null),
    refetch: () => {
      void mutate();
    },
    createProject,
    updateProject,
    deleteProject,
  };
}
