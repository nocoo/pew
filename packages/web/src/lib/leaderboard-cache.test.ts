import type { LeaderboardSnapshot } from "@pew/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createMockDbRead } from "@/__tests__/test-utils";
import { getCachedLeaderboard, getLeaderboardCacheStats } from "./leaderboard-cache";
import { fetchLeaderboardPage, useLeaderboard } from "@/hooks/use-leaderboard";

vi.mock("react", { spy: true });

function snapshot(overrides: Partial<LeaderboardSnapshot> = {}): LeaderboardSnapshot {
  return {
    key: "opaque-worker-key",
    revision: "1",
    id: "snapshot-1",
    generatedAt: Date.now(),
    expiresAt: Date.now() + 600_000,
    rows: [],
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("leaderboard memory cache", () => {
  let db: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-03T10:00:00Z"));
    db = createMockDbRead();
    db.getLeaderboardRevision.mockResolvedValue("1");
    db.getLeaderboardSnapshot.mockImplementation(async () => snapshot());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses only revision RPCs on warm hits and keeps the original absolute expiry", async () => {
    const first = await getCachedLeaderboard(db, {});
    vi.advanceTimersByTime(599_999);
    expect(await getCachedLeaderboard(db, {})).toEqual(first);
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(1);
    expect(db.getLeaderboardRevision).toHaveBeenCalledTimes(4);
    vi.advanceTimersByTime(1);
    expect((await getCachedLeaderboard(db, {})).generatedAt).toBe(Date.now());
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
  });

  it("normalizes filter order and separates every filter dimension", async () => {
    await getCachedLeaderboard(db, { teamId: "t", source: "codex" });
    await getCachedLeaderboard(db, { source: "codex", teamId: "t" });
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(1);
    for (const filters of [
      {},
      { fromDate: "2026-09-01" },
      { teamId: "t" },
      { orgId: "t" },
      { source: "codex" },
      { model: "codex" },
      { teamId: "t|codex" },
    ]) {
      await getCachedLeaderboard(db, filters);
    }
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(8);
  });

  it("isolates DbRead instances", async () => {
    const other = createMockDbRead();
    other.getLeaderboardRevision.mockResolvedValue("1");
    other.getLeaderboardSnapshot.mockResolvedValue(snapshot({ id: "other" }));
    await getCachedLeaderboard(db, {});
    expect((await getCachedLeaderboard(other, {})).id).toBe("other");
  });

  it("coalesces simultaneous fills for the same revision and filters", async () => {
    const load = deferred<LeaderboardSnapshot>();
    db.getLeaderboardSnapshot.mockReturnValueOnce(load.promise);
    const requests = Array.from({ length: 10 }, () => getCachedLeaderboard(db, {}));
    await vi.waitFor(() => expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(1));
    const data = snapshot();
    load.resolve(data);
    expect(await Promise.all(requests)).toEqual(Array(10).fill(data));
    expect(db.getLeaderboardRevision).toHaveBeenCalledTimes(20);
  });

  it("keeps a fill coalesced while its post-read revision check is pending", async () => {
    const revision = deferred<string>();
    db.getLeaderboardRevision.mockResolvedValueOnce("1").mockReturnValueOnce(revision.promise);
    const first = getCachedLeaderboard(db, {});
    await vi.waitFor(() => expect(db.getLeaderboardRevision).toHaveBeenCalledTimes(2));
    expect((await getCachedLeaderboard(db, {})).revision).toBe("1");
    revision.resolve("1");
    await first;
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(1);
  });

  it("bounds in-flight registrations while still sharing existing work", async () => {
    const load = deferred<LeaderboardSnapshot>();
    db.getLeaderboardSnapshot.mockReturnValue(load.promise);
    const requests = Array.from({ length: 64 }, (_, i) =>
      getCachedLeaderboard(db, { model: String(i) }),
    );
    await vi.waitFor(() => expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(64));
    await expect(getCachedLeaderboard(db, { model: "overflow" })).rejects.toThrow();
    const shared = getCachedLeaderboard(db, { model: "0" });
    load.resolve(snapshot());
    await Promise.all([...requests, shared]);
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(64);
    await getCachedLeaderboard(db, { model: "overflow" });
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(65);
  });

  it("invalidates warm snapshots before exposing changed identities", async () => {
    await getCachedLeaderboard(db, {});
    db.getLeaderboardRevision.mockResolvedValue("2");
    db.getLeaderboardSnapshot.mockResolvedValue(snapshot({ revision: "2", id: "safe" }));
    expect((await getCachedLeaderboard(db, {})).id).toBe("safe");
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
  });

  it("rechecks the revision even after memory hits", async () => {
    await getCachedLeaderboard(db, {});
    db.getLeaderboardRevision.mockResolvedValueOnce("1").mockResolvedValue("2");
    db.getLeaderboardSnapshot.mockResolvedValue(snapshot({ revision: "2", id: "safe" }));
    expect((await getCachedLeaderboard(db, {})).id).toBe("safe");
  });

  it("does not share in-flight fills across revisions or admit their stale results", async () => {
    const old = deferred<LeaderboardSnapshot>();
    db.getLeaderboardSnapshot.mockReturnValueOnce(old.promise);
    const first = getCachedLeaderboard(db, {});
    await vi.waitFor(() => expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(1));
    db.getLeaderboardRevision.mockResolvedValue("2");
    db.getLeaderboardSnapshot.mockResolvedValue(snapshot({ revision: "2", id: "safe" }));
    expect((await getCachedLeaderboard(db, {})).id).toBe("safe");
    old.resolve(snapshot());
    expect((await first).id).toBe("safe");
    expect((await getCachedLeaderboard(db, {})).id).toBe("safe");
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
  });

  it("retries once when the worker result does not match the observed revision", async () => {
    db.getLeaderboardSnapshot.mockResolvedValueOnce(snapshot({ revision: "0" }));
    expect((await getCachedLeaderboard(db, {})).revision).toBe("1");
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
  });

  it("fails closed after two revision races", async () => {
    db.getLeaderboardRevision
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce("2")
      .mockResolvedValueOnce("2")
      .mockResolvedValueOnce("3");
    db.getLeaderboardSnapshot
      .mockResolvedValueOnce(snapshot())
      .mockResolvedValueOnce(snapshot({ revision: "2" }));
    await expect(getCachedLeaderboard(db, {})).rejects.toThrow();
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
    expect(db.getLeaderboardRevision).toHaveBeenCalledTimes(4);
  });

  it("checks expiry again after the final revision await", async () => {
    db.getLeaderboardSnapshot.mockResolvedValueOnce(snapshot({ expiresAt: Date.now() + 1 }));
    db.getLeaderboardRevision.mockResolvedValueOnce("1").mockImplementationOnce(async () => {
      vi.advanceTimersByTime(1);
      return "1";
    });
    expect((await getCachedLeaderboard(db, {})).expiresAt).toBe(Date.now() + 600_000);
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
  });

  it("does not reuse a fill that expired while in flight", async () => {
    const load = deferred<LeaderboardSnapshot>();
    db.getLeaderboardSnapshot.mockReturnValueOnce(load.promise);
    const first = getCachedLeaderboard(db, {});
    const second = getCachedLeaderboard(db, {});
    await vi.waitFor(() => expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(1));
    load.resolve(snapshot({ expiresAt: Date.now() }));
    expect((await Promise.all([first, second])).every((data) => data.expiresAt > Date.now())).toBe(
      true,
    );
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
  });

  it.each([NaN, Infinity, -1, 0])(
    "rejects invalid expiry %s without caching it",
    async (expiresAt) => {
      db.getLeaderboardSnapshot.mockResolvedValue(snapshot({ expiresAt }));
      await expect(getCachedLeaderboard(db, {})).rejects.toThrow();
      expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
    },
  );

  it("rejects expiry before generation", async () => {
    db.getLeaderboardSnapshot.mockResolvedValue(snapshot({ generatedAt: Date.now() + 700_000 }));
    await expect(getCachedLeaderboard(db, {})).rejects.toThrow();
  });

  it("does not return a warm value when the revision authority fails", async () => {
    await getCachedLeaderboard(db, {});
    db.getLeaderboardRevision.mockRejectedValueOnce(new Error("authority unavailable"));
    await expect(getCachedLeaderboard(db, {})).rejects.toThrow("authority unavailable");
  });

  it("removes failed in-flight work so a later request can succeed", async () => {
    db.getLeaderboardSnapshot.mockRejectedValueOnce(new Error("worker unavailable"));
    await expect(getCachedLeaderboard(db, {})).rejects.toThrow("worker unavailable");
    await expect(getCachedLeaderboard(db, {})).resolves.toMatchObject({ revision: "1" });
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
  });

  it("bounds stored snapshots to 128 entries", async () => {
    for (let i = 0; i <= 128; i++) await getCachedLeaderboard(db, { model: String(i) });
    await getCachedLeaderboard(db, { model: "128" });
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(129);
    await getCachedLeaderboard(db, { model: "0" });
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(130);
  });

  it("evicts the least recently used snapshot rather than the oldest fill", async () => {
    for (let i = 0; i < 128; i++) await getCachedLeaderboard(db, { model: String(i) });
    await getCachedLeaderboard(db, { model: "0" });
    await getCachedLeaderboard(db, { model: "128" });
    await getCachedLeaderboard(db, { model: "0" });
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(129);
    await getCachedLeaderboard(db, { model: "1" });
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(130);
  });

  it("bounds serialized payloads to 8 MiB before the entry count limit", async () => {
    db.getLeaderboardSnapshot.mockImplementation(async () =>
      snapshot({ id: "x".repeat(250 * 1024) }),
    );
    for (let i = 0; i < 34; i++) await getCachedLeaderboard(db, { model: String(i) });
    await getCachedLeaderboard(db, { model: "33" });
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(34);
    await getCachedLeaderboard(db, { model: "0" });
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(35);
  });

  it("returns oversized UTF-8 snapshots intact but never retains them", async () => {
    const data = snapshot({ id: "\u4e2d".repeat(100 * 1024) });
    db.getLeaderboardSnapshot.mockResolvedValue(data);
    expect(await getCachedLeaderboard(db, {})).toEqual(data);
    expect(await getCachedLeaderboard(db, {})).toEqual(data);
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(2);
  });

  it("measures the actual cold snapshot when a smaller warm result is reinserted then evicted", async () => {
    await getCachedLeaderboard(db, {});
    const warmRevision = deferred<string>();
    db.getLeaderboardRevision.mockResolvedValueOnce("1").mockReturnValueOnce(warmRevision.promise);
    const warm = getCachedLeaderboard(db, {});
    await vi.waitFor(() => expect(db.getLeaderboardRevision).toHaveBeenCalledTimes(4));
    for (let i = 0; i < 128; i++) await getCachedLeaderboard(db, { model: `first-${i}` });

    const coldSnapshot = deferred<LeaderboardSnapshot>();
    db.getLeaderboardSnapshot.mockReturnValueOnce(coldSnapshot.promise);
    const cold = getCachedLeaderboard(db, {});
    await vi.waitFor(() => expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(130));
    warmRevision.resolve("1");
    await warm;

    const coldRevision = deferred<string>();
    db.getLeaderboardRevision.mockReturnValueOnce(coldRevision.promise);
    vi.advanceTimersByTime(1);
    const oversized = snapshot({ id: "x".repeat(300 * 1024) });
    coldSnapshot.resolve(oversized);
    const revisionCalls = db.getLeaderboardRevision.mock.calls.length;
    await vi.waitFor(() =>
      expect(db.getLeaderboardRevision).toHaveBeenCalledTimes(revisionCalls + 1),
    );
    for (let i = 0; i < 128; i++) await getCachedLeaderboard(db, { model: `second-${i}` });
    coldRevision.resolve("1");
    expect(await cold).toEqual(oversized);
    const fills = db.getLeaderboardSnapshot.mock.calls.length;
    expect((await getCachedLeaderboard(db, {})).id === "snapshot-1").toBe(true);
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(fills + 1);
  });

  it("isolates every returned snapshot, including nested rows and teams", async () => {
    const data = snapshot({
      rows: [
        {
          user_id: "u1",
          name: "Alice",
          nickname: null,
          image: null,
          slug: null,
          total_tokens: 100,
          input_tokens: 50,
          output_tokens: 40,
          cached_input_tokens: 10,
          session_count: 0,
          total_duration_seconds: 0,
          teams: [{ id: "t1", name: "Original", logoUrl: null }],
        },
      ],
    });
    const original = structuredClone(data);
    db.getLeaderboardSnapshot.mockResolvedValue(data);
    const first = await getCachedLeaderboard(db, {});
    first.rows[0]!.teams[0]!.name = "Changed";
    first.rows[0]!.total_tokens = 999;
    first.rows.push(first.rows[0]!);
    first.id = "changed";
    const second = await getCachedLeaderboard(db, {});
    expect(second).toEqual(original);
    second.rows.length = 0;
    expect(await getCachedLeaderboard(db, {})).toEqual(original);
    expect(db.getLeaderboardSnapshot).toHaveBeenCalledTimes(1);
  });

  it("exposes isolated process memory counters without filters or user data", async () => {
    const empty = getLeaderboardCacheStats(db);
    expect(empty).toEqual({
      instanceId: expect.stringMatching(/^[a-f0-9-]{36}$/),
      entries: 0,
      serializedBytes: 0,
      hits: 0,
      misses: 0,
      inflight: 0,
      maxEntries: 128,
      maxSerializedBytes: 8 * 1024 * 1024,
      maxEntrySerializedBytes: 256 * 1024,
      maxInflight: 64,
    });
    expect(db.getLeaderboardRevision).not.toHaveBeenCalled();
    const data = await getCachedLeaderboard(db, { model: "private-filter" });
    await getCachedLeaderboard(db, { model: "private-filter" });
    const populated = getLeaderboardCacheStats(db);
    expect(populated).toEqual({
      ...empty,
      entries: 1,
      serializedBytes: Buffer.byteLength(JSON.stringify(data)),
      hits: 1,
      misses: 1,
    });
    expect(getLeaderboardCacheStats(createMockDbRead())).toEqual(empty);
    populated.entries = 0;
    expect(getLeaderboardCacheStats(db).entries).toBe(1);
    const pending = deferred<LeaderboardSnapshot>();
    db.getLeaderboardSnapshot.mockReturnValueOnce(pending.promise);
    const loading = getCachedLeaderboard(db, {});
    await vi.waitFor(() => expect(getLeaderboardCacheStats(db).inflight).toBe(1));
    pending.resolve(snapshot());
    await loading;
    expect(getLeaderboardCacheStats(db)).toMatchObject({ entries: 2, misses: 2, inflight: 0 });
  });
});

describe("leaderboard client pagination", () => {
  const data = {
    period: "week",
    scope: "global",
    entries: [],
    hasMore: true,
    snapshotId: "new",
    generatedAt: 1,
    expiresAt: 2,
  };

  afterEach(() => vi.restoreAllMocks());

  it("pins subsequent pages to their original snapshot", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(data));
    const onRestart = vi.fn();
    const params = new URLSearchParams({ period: "week", limit: "20", offset: "20" });
    expect(
      await fetchLeaderboardPage(params, "original", onRestart, new AbortController().signal),
    ).toEqual({ data, restarted: false });
    expect(
      new URL(fetchSpy.mock.calls[0]![0] as string, "http://localhost").searchParams.get(
        "snapshot",
      ),
    ).toBe("original");
    expect(onRestart).not.toHaveBeenCalled();
    expect(params.has("snapshot")).toBe(false);
  });

  it("clears accumulated state before retrying the first page once, retaining filters", async () => {
    const onRestart = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ code: "LEADERBOARD_CHANGED" }, { status: 409 }))
      .mockImplementationOnce(async () => {
        expect(onRestart).toHaveBeenCalledTimes(1);
        return Response.json(data);
      });
    const params = new URLSearchParams({
      period: "month",
      limit: "10",
      offset: "30",
      team: "t1",
      source: "codex",
    });
    expect(
      await fetchLeaderboardPage(params, "old", onRestart, new AbortController().signal),
    ).toEqual({ data, restarted: true });
    const query = new URL(fetchSpy.mock.calls[1]![0] as string, "http://localhost").searchParams;
    expect(Object.fromEntries(query)).toEqual({
      period: "month",
      limit: "10",
      team: "t1",
      source: "codex",
    });
  });

  it("stops after a second 409 instead of retrying forever", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ error: "changed again" }, { status: 409 }));
    const onRestart = vi.fn();
    await expect(
      fetchLeaderboardPage(new URLSearchParams(), "old", onRestart, new AbortController().signal),
    ).rejects.toThrow("changed again");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it("propagates ordinary errors without a pagination restart", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ error: "denied" }, { status: 403 }));
    const onRestart = vi.fn();
    await expect(
      fetchLeaderboardPage(new URLSearchParams(), null, onRestart, new AbortController().signal),
    ).rejects.toThrow("denied");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onRestart).not.toHaveBeenCalled();
  });

  it("does not reset a newer filter's state when an old page returns 409", async () => {
    const response = deferred<Response>();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(response.promise);
    const controller = new AbortController();
    const onRestart = vi.fn();
    const pending = fetchLeaderboardPage(
      new URLSearchParams(),
      "old",
      onRestart,
      controller.signal,
    );
    controller.abort();
    response.resolve(Response.json({}, { status: 409 }));
    await expect(pending).rejects.toThrow();
    expect(onRestart).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("discards a stale response that finishes parsing after cancellation", async () => {
    const parsed = deferred<unknown>();
    const res = Response.json(data);
    const json = vi.spyOn(res, "json").mockReturnValue(parsed.promise);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
    const controller = new AbortController();
    const pending = fetchLeaderboardPage(new URLSearchParams(), null, vi.fn(), controller.signal);
    await vi.waitFor(() => expect(json).toHaveBeenCalled());
    controller.abort();
    parsed.resolve(data);
    await expect(pending).rejects.toThrow();
  });
});

describe("disabled leaderboard state", () => {
  afterEach(() => vi.restoreAllMocks());

  it("clears visible pagination and loading state while invalidating the pending request", () => {
    const initial = [[{ user: { id: "old-user" } }], 40, true, true, "old error", true, 20];
    const setters = initial.map(() => vi.fn());
    const state = vi.spyOn(React, "useState");
    initial.forEach((value, index) => {
      state.mockReturnValueOnce([value, setters[index]!]);
    });
    const controller = new AbortController();
    const requestId = { current: 5 };
    const snapshot = { current: { filterKey: "old", id: "old-snapshot" } };
    const lastFilter = { current: "old" };
    vi.spyOn(React, "useRef")
      .mockReturnValueOnce(requestId)
      .mockReturnValueOnce({ current: controller })
      .mockReturnValueOnce(snapshot)
      .mockReturnValueOnce(lastFilter);
    vi.spyOn(React, "useCallback").mockImplementation((callback) => callback);
    const effect = vi.spyOn(React, "useEffect").mockImplementation(() => {});

    useLeaderboard({ enabled: false, teamId: "old-team" });
    effect.mock.calls[0]![0]();

    [[], 0, false, false, null, false, 0].forEach((value, index) => {
      expect(setters[index]).toHaveBeenCalledWith(value);
    });
    expect(controller.signal.aborted).toBe(true);
    expect(requestId.current).toBe(6);
    expect(snapshot.current).toBeNull();
    expect(lastFilter.current).toBeNull();
  });
});
