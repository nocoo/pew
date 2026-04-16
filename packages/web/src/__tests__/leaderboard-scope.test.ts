import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  SCOPE_STORAGE_KEY,
  loadScopeFromStorage,
  saveScopeToStorage,
  type ScopeSelection,
} from "@/lib/leaderboard-scope";

// Mock localStorage
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, val: string) => store.set(key, val)),
  removeItem: vi.fn((key: string) => store.delete(key)),
};

Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

describe("leaderboard-scope", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("SCOPE_STORAGE_KEY is defined", () => {
    expect(SCOPE_STORAGE_KEY).toBe("pew:leaderboard:scope");
  });

  // ---- loadScopeFromStorage ----

  it("returns null when nothing stored", () => {
    expect(loadScopeFromStorage()).toBeNull();
  });

  it("loads global scope", () => {
    store.set(SCOPE_STORAGE_KEY, JSON.stringify({ type: "global" }));
    expect(loadScopeFromStorage()).toEqual({ type: "global" });
  });

  it("loads org scope with id", () => {
    const scope: ScopeSelection = { type: "org", id: "o1" };
    store.set(SCOPE_STORAGE_KEY, JSON.stringify(scope));
    expect(loadScopeFromStorage()).toEqual(scope);
  });

  it("loads team scope with id", () => {
    const scope: ScopeSelection = { type: "team", id: "t1" };
    store.set(SCOPE_STORAGE_KEY, JSON.stringify(scope));
    expect(loadScopeFromStorage()).toEqual(scope);
  });

  it("returns null for org scope without id", () => {
    store.set(SCOPE_STORAGE_KEY, JSON.stringify({ type: "org" }));
    expect(loadScopeFromStorage()).toBeNull();
  });

  it("returns null for team scope without id", () => {
    store.set(SCOPE_STORAGE_KEY, JSON.stringify({ type: "team" }));
    expect(loadScopeFromStorage()).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    store.set(SCOPE_STORAGE_KEY, "not-json");
    expect(loadScopeFromStorage()).toBeNull();
  });

  it("returns null when localStorage throws", () => {
    mockLocalStorage.getItem.mockImplementationOnce(() => {
      throw new Error("denied");
    });
    expect(loadScopeFromStorage()).toBeNull();
  });

  // ---- saveScopeToStorage ----

  it("saves scope to localStorage", () => {
    const scope: ScopeSelection = { type: "global" };
    saveScopeToStorage(scope);
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      SCOPE_STORAGE_KEY,
      JSON.stringify(scope),
    );
  });

  it("silently catches write errors", () => {
    mockLocalStorage.setItem.mockImplementationOnce(() => {
      throw new Error("quota");
    });
    expect(() => saveScopeToStorage({ type: "global" })).not.toThrow();
  });
});
