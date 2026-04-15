"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  loadScopeFromStorage,
  saveScopeToStorage,
  type ScopeSelection,
  type Organization,
  type Team,
} from "@/lib/leaderboard-scope";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseLeaderboardScopeReturn {
  /** Current scope selection */
  scope: ScopeSelection;
  /** Update scope and persist to localStorage */
  setScope: (scope: ScopeSelection) => void;
  /** User's organizations */
  organizations: Organization[];
  /** User's teams */
  teams: Team[];
  /** Whether scope initialization is complete (ready to fetch leaderboard) */
  scopeInitialized: boolean;
  /** Whether orgs/teams have been loaded */
  orgsLoaded: boolean;
  /** Whether session is still loading */
  isSessionLoading: boolean;
  /** Whether user is authenticated */
  isAuthenticated: boolean;
  /** Computed teamId for useLeaderboard */
  teamId: string | null;
  /** Computed orgId for useLeaderboard */
  orgId: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Shared hook for leaderboard scope management.
 * Handles:
 * - Auth-gated scope initialization
 * - Organization/team fetching with orgsLoaded guard
 * - Scope validation (reset invalid stored scope)
 * - localStorage persistence
 */
export function useLeaderboardScope(): UseLeaderboardScopeReturn {
  const { status } = useSession();
  const isAuthenticated = status === "authenticated";
  const isSessionLoading = status === "loading";

  const [scope, setScopeState] = useState<ScopeSelection>({ type: "global" });
  const [scopeInitialized, setScopeInitialized] = useState(false);
  const [orgsLoaded, setOrgsLoaded] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  // Fetch user's organizations and teams
  const fetchOrgsAndTeams = useCallback(async () => {
    try {
      const [orgsRes, teamsRes] = await Promise.all([
        fetch("/api/organizations/mine"),
        fetch("/api/teams"),
      ]);

      if (orgsRes.ok) {
        const orgsJson = await orgsRes.json();
        setOrganizations(orgsJson.organizations ?? []);
      }
      if (teamsRes.ok) {
        const teamsJson = await teamsRes.json();
        setTeams(teamsJson.teams ?? []);
      }
    } catch {
      // Silently fail — scope dropdown optional
    } finally {
      setOrgsLoaded(true);
    }
  }, []);

  // Initialize scope from localStorage and fetch orgs/teams
  // Wait for session to resolve before deciding auth state
  useEffect(() => {
    // Still loading session - wait
    if (isSessionLoading) {
      return;
    }

    // Unauthenticated - use global scope immediately
    if (!isAuthenticated) {
      setScopeInitialized(true);
      setOrgsLoaded(true);
      return;
    }

    // Authenticated - fetch orgs/teams and restore scope
    fetchOrgsAndTeams().then(() => {
      const stored = loadScopeFromStorage();
      if (stored) {
        setScopeState(stored);
      }
      setScopeInitialized(true);
    });
  }, [isSessionLoading, isAuthenticated, fetchOrgsAndTeams]);

  // Validate stored scope against available orgs/teams
  // (intentionally calling setState in effect to correct invalid state after async load)
  useEffect(() => {
    if (!scopeInitialized) return;

    if (scope.type === "org" && scope.id) {
      const valid = organizations.some((o) => o.id === scope.id);
      if (!valid) {
        setScopeState({ type: "global" });
        saveScopeToStorage({ type: "global" });
      }
    } else if (scope.type === "team" && scope.id) {
      const valid = teams.some((t) => t.id === scope.id);
      if (!valid) {
        setScopeState({ type: "global" });
        saveScopeToStorage({ type: "global" });
      }
    }
  }, [scopeInitialized, scope, organizations, teams]);

  // Handle scope change with persistence
  const setScope = useCallback((newScope: ScopeSelection) => {
    setScopeState(newScope);
    saveScopeToStorage(newScope);
  }, []);

  // Computed IDs for useLeaderboard
  const teamId = scope.type === "team" ? scope.id ?? null : null;
  const orgId = scope.type === "org" ? scope.id ?? null : null;

  return {
    scope,
    setScope,
    organizations,
    teams,
    scopeInitialized,
    orgsLoaded,
    isSessionLoading,
    isAuthenticated,
    teamId,
    orgId,
  };
}
