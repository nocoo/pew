import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import type { LeaderboardFilters, LeaderboardSnapshot } from "@pew/core";
import type { DbRead } from "./db";

const MAX_ENTRIES = 128;
const MAX_INFLIGHT = 64;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ENTRY_BYTES = 256 * 1024;

interface Cache {
  entries: Map<string, { snapshot: LeaderboardSnapshot; bytes: number }>;
  inflight: Map<string, Promise<LeaderboardSnapshot>>;
  bytes: number;
  hits: number;
  misses: number;
}

const caches = new WeakMap<DbRead, Cache>();
const instanceId = randomUUID();

export function getLeaderboardCacheStats(db: DbRead) {
  const cache = caches.get(db);
  return {
    instanceId,
    entries: cache?.entries.size ?? 0,
    serializedBytes: cache?.bytes ?? 0,
    hits: cache?.hits ?? 0,
    misses: cache?.misses ?? 0,
    inflight: cache?.inflight.size ?? 0,
    maxEntries: MAX_ENTRIES,
    maxSerializedBytes: MAX_BYTES,
    maxEntrySerializedBytes: MAX_ENTRY_BYTES,
    maxInflight: MAX_INFLIGHT,
  };
}

function remove(cache: Cache, key: string, bytes: number) {
  cache.bytes -= bytes;
  cache.entries.delete(key);
}

function isFresh(snapshot: LeaderboardSnapshot, revision: string): boolean {
  return (
    snapshot.revision === revision &&
    Number.isFinite(snapshot.generatedAt) &&
    Number.isFinite(snapshot.expiresAt) &&
    snapshot.expiresAt > snapshot.generatedAt &&
    snapshot.expiresAt > Date.now()
  );
}

export async function getCachedLeaderboard(
  db: DbRead,
  filters: LeaderboardFilters,
): Promise<LeaderboardSnapshot> {
  let cache = caches.get(db);
  if (!cache) {
    cache = { entries: new Map(), inflight: new Map(), bytes: 0, hits: 0, misses: 0 };
    caches.set(db, cache);
  }
  const key = JSON.stringify([
    filters.fromDate,
    filters.teamId,
    filters.orgId,
    filters.source,
    filters.model,
  ]);

  for (let attempt = 0; attempt < 2; attempt++) {
    const revision = await db.getLeaderboardRevision();
    for (const [storedKey, entry] of cache.entries) {
      if (!isFresh(entry.snapshot, revision)) remove(cache, storedKey, entry.bytes);
    }

    const flightKey = JSON.stringify([revision, key]);
    let pending: Promise<LeaderboardSnapshot> | undefined;
    try {
      let snapshot = cache.entries.get(key)?.snapshot;
      if (!snapshot) {
        cache.misses++;
        pending = cache.inflight.get(flightKey);
        if (!pending) {
          if (cache.inflight.size >= MAX_INFLIGHT)
            throw new Error("Too many leaderboard snapshot requests");
          pending = db.getLeaderboardSnapshot(filters);
          cache.inflight.set(flightKey, pending);
        }
        snapshot = await pending;
      } else {
        cache.hits++;
      }

      const result = structuredClone(snapshot);
      const bytes = Buffer.byteLength(JSON.stringify(snapshot));
      const currentRevision = await db.getLeaderboardRevision();
      if (currentRevision !== revision || !isFresh(snapshot, currentRevision)) continue;

      const cached = cache.entries.get(key);
      if (cached) {
        cache.entries.delete(key);
        cache.entries.set(key, cached);
      } else if (bytes <= MAX_ENTRY_BYTES) {
        for (const [storedKey, entry] of cache.entries) {
          if (cache.entries.size < MAX_ENTRIES && cache.bytes + bytes <= MAX_BYTES) break;
          remove(cache, storedKey, entry.bytes);
        }
        cache.entries.set(key, { snapshot, bytes });
        cache.bytes += bytes;
      }
      return result;
    } finally {
      if (pending && cache.inflight.get(flightKey) === pending) cache.inflight.delete(flightKey);
    }
  }
  throw new Error("Leaderboard snapshot changed or expired during read");
}
