// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Team {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
}

/** Scope selection: global, or org/team with ID */
export interface ScopeSelection {
  type: "global" | "org" | "team";
  id?: string;
}

// ---------------------------------------------------------------------------
// localStorage persistence
// ---------------------------------------------------------------------------

export const SCOPE_STORAGE_KEY = "pew:leaderboard:scope";

export function loadScopeFromStorage(): ScopeSelection | null {
  try {
    const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as ScopeSelection;
    if (parsed.type === "global" || ((parsed.type === "org" || parsed.type === "team") && parsed.id)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveScopeToStorage(scope: ScopeSelection): void {
  try {
    localStorage.setItem(SCOPE_STORAGE_KEY, JSON.stringify(scope));
  } catch {
    // Silently fail
  }
}
