import type { D1Database, KVNamespace } from "@cloudflare/workers-types";
import {
  MAX_STRING_LENGTH,
  type LeaderboardFilters,
  type LeaderboardSnapshot,
  type LeaderboardSnapshotRow,
} from "@pew/core";

const REVISION_SQL = "SELECT revision FROM leaderboard_revision WHERE id = 1";
const MAX_ROWS = 5000;
const MAX_BYTES = 256 * 1024;
const COUNTS = ["total_tokens", "input_tokens", "output_tokens", "cached_input_tokens"] as const;
const nullableString = (value: unknown) => value === null || typeof value === "string";
const count = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getLeaderboardRevision(db: D1Database): Promise<string> {
  const row = await db.prepare(REVISION_SQL).first<{ revision: string }>();
  if (!row || !/^[a-f0-9]{32}$/.test(row.revision))
    throw new Error("Leaderboard revision unavailable");
  return row.revision;
}

export async function invalidateLeaderboard(db: D1Database): Promise<void> {
  await db
    .prepare("UPDATE leaderboard_revision SET revision = lower(hex(randomblob(16))) WHERE id = 1")
    .run();
}

function valid(
  value: unknown,
  key: string,
  revision: string,
  ttl: number,
): value is LeaderboardSnapshot {
  if (!value || typeof value !== "object") return false;
  const s = value as LeaderboardSnapshot;
  return (
    s.key === key &&
    s.revision === revision &&
    typeof s.id === "string" &&
    /^[a-f0-9]{64}$/.test(s.id) &&
    Number.isSafeInteger(s.generatedAt) &&
    s.generatedAt <= Date.now() &&
    s.expiresAt === s.generatedAt + ttl &&
    s.expiresAt > Date.now() &&
    Array.isArray(s.rows) &&
    new Set(s.rows.map((r) => r?.user_id)).size === s.rows.length &&
    s.rows.every(
      (r) =>
        r &&
        typeof r.user_id === "string" &&
        [r.name, r.nickname, r.image, r.slug].every(nullableString) &&
        COUNTS.every((field) => count(r[field])) &&
        (r.session_count === null || count(r.session_count)) &&
        (r.total_duration_seconds === null || count(r.total_duration_seconds)) &&
        Array.isArray(r.teams) &&
        r.teams.every(
          (t) =>
            t &&
            typeof t.id === "string" &&
            typeof t.name === "string" &&
            nullableString(t.logoUrl),
        ),
    )
  );
}

function projectSnapshot(s: LeaderboardSnapshot): LeaderboardSnapshot {
  return {
    key: s.key,
    revision: s.revision,
    id: s.id,
    generatedAt: s.generatedAt,
    expiresAt: s.expiresAt,
    rows: s.rows.map((r) => ({
      user_id: r.user_id,
      name: r.name,
      nickname: r.nickname,
      image: r.image,
      slug: r.slug,
      total_tokens: r.total_tokens,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cached_input_tokens: r.cached_input_tokens,
      session_count: r.session_count,
      total_duration_seconds: r.total_duration_seconds,
      teams: r.teams.map((t) => ({ id: t.id, name: t.name, logoUrl: t.logoUrl })),
    })),
  };
}

async function buildSnapshot(
  filters: LeaderboardFilters,
  db: D1Database,
  key: string,
  ttl: number,
): Promise<LeaderboardSnapshot> {
  const conditions = ["(ur.event_id = '' OR ur.total_tokens > 0)"];
  const params: string[] = [];
  if (filters.fromDate) {
    conditions.push("ur.hour_start >= ?");
    params.push(filters.fromDate);
  }
  if (filters.source) {
    conditions.push("ur.source = ?");
    params.push(filters.source);
  }
  if (filters.model) {
    conditions.push("ur.model = ?");
    params.push(filters.model);
  }
  if (filters.teamId) {
    conditions.push(
      "EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id=ur.user_id AND tm.team_id=?)",
    );
    params.push(filters.teamId);
  }
  if (filters.orgId) {
    conditions.push(
      "EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id=ur.user_id AND om.org_id=?)",
    );
    params.push(filters.orgId);
  }
  const sessionConditions = ["sr.user_id IN (SELECT id FROM users WHERE is_public = 1)"];
  const sessionParams: string[] = [];
  if (filters.fromDate) {
    sessionConditions.push("sr.started_at >= ?");
    sessionParams.push(filters.fromDate);
  }
  if (filters.source) {
    sessionConditions.push("sr.source = ?");
    sessionParams.push(filters.source);
  }
  if (filters.teamId) {
    sessionConditions.push(
      "EXISTS (SELECT 1 FROM team_members tm WHERE tm.user_id=sr.user_id AND tm.team_id=?)",
    );
    sessionParams.push(filters.teamId);
  }
  if (filters.orgId) {
    sessionConditions.push(
      "EXISTS (SELECT 1 FROM organization_members om WHERE om.user_id=sr.user_id AND om.org_id=?)",
    );
    sessionParams.push(filters.orgId);
  }
  const generatedAt = Date.now();
  const results = await db.batch<Record<string, unknown>>([
    db.prepare(REVISION_SQL),
    db
      .prepare(`WITH totals AS (
      SELECT ur.user_id, SUM(ur.total_tokens) AS total_tokens,
        SUM(ur.input_tokens) AS input_tokens, SUM(ur.output_tokens) AS output_tokens,
        SUM(ur.cached_input_tokens) AS cached_input_tokens
      FROM usage_bases ur WHERE ${conditions.join(" AND ")} GROUP BY ur.user_id
    ) SELECT ur.*, u.name, u.nickname, u.image, u.slug FROM totals ur
      JOIN users u ON u.id=ur.user_id WHERE u.is_public=1 AND ur.total_tokens>0
      ORDER BY ur.total_tokens DESC, ur.user_id ASC`)
      .bind(...params),
    db.prepare(`SELECT tm.user_id, t.id, t.name, t.logo_url AS logoUrl FROM team_members tm
      JOIN teams t ON t.id=tm.team_id JOIN users u ON u.id=tm.user_id WHERE u.is_public=1
      ORDER BY tm.user_id, t.id`),
    ...(!filters.model
      ? [
          db
            .prepare(`SELECT sr.user_id, COUNT(*) AS session_count,
      COALESCE(SUM(sr.duration_seconds),0) AS total_duration_seconds
      FROM session_records sr
      WHERE ${sessionConditions.join(" AND ")} GROUP BY sr.user_id`)
            .bind(...sessionParams),
        ]
      : []),
  ]);
  if (results.some((r) => !r.success)) throw new Error("Leaderboard query failed");
  const rows = results[1].results as unknown as LeaderboardSnapshotRow[];
  const teams = new Map<string, LeaderboardSnapshotRow["teams"]>();
  for (const r of results[2].results) {
    const userId = r.user_id as string;
    const list = teams.get(userId) ?? [];
    list.push({ id: r.id as string, name: r.name as string, logoUrl: r.logoUrl as string | null });
    teams.set(userId, list);
  }
  const sessions = new Map((results[3]?.results ?? []).map((r) => [r.user_id, r]));
  const snapshotRows = rows.map((r) => ({
    ...r,
    teams: teams.get(r.user_id) ?? [],
    session_count: filters.model
      ? null
      : ((sessions.get(r.user_id)?.session_count as number | undefined) ?? 0),
    total_duration_seconds: filters.model
      ? null
      : ((sessions.get(r.user_id)?.total_duration_seconds as number | undefined) ?? 0),
  }));
  const revision = results[0].results[0]?.revision as string;
  return {
    key,
    revision,
    id: await hash([revision, key, snapshotRows]),
    generatedAt,
    expiresAt: generatedAt + ttl,
    rows: snapshotRows,
  };
}

export async function getLeaderboardSnapshot(
  filters: LeaderboardFilters,
  db: D1Database,
  kv: KVNamespace,
): Promise<LeaderboardSnapshot> {
  if (
    Object.values(filters).some(
      (v) => v !== undefined && (typeof v !== "string" || v.length > MAX_STRING_LENGTH),
    )
  ) {
    throw new Error("Invalid leaderboard filter");
  }
  const key = await hash([
    filters.fromDate ?? "",
    filters.teamId ?? "",
    filters.orgId ?? "",
    filters.source ?? "",
    filters.model ?? "",
  ]);
  const ttl = filters.fromDate ? 600_000 : 1_800_000;
  for (let attempt = 0; attempt < 2; attempt++) {
    const revision = await getLeaderboardRevision(db);
    const cacheKey = `lb:v1:${revision}:${key}`;
    let cached: unknown;
    try {
      const text = await kv.get(cacheKey, "text");
      if (text && new TextEncoder().encode(text).byteLength <= MAX_BYTES) cached = JSON.parse(text);
    } catch {
      console.warn("Leaderboard cache read unavailable");
    }
    let snapshot: LeaderboardSnapshot;
    if (
      valid(cached, key, revision, ttl) &&
      cached.rows.length <= MAX_ROWS &&
      cached.id === (await hash([revision, key, cached.rows]))
    )
      snapshot = projectSnapshot(cached);
    else {
      snapshot = await buildSnapshot(filters, db, key, ttl);
      if (snapshot.revision !== revision) continue;
      if (!valid(snapshot, key, revision, ttl)) throw new Error("Invalid leaderboard snapshot");
      const text = JSON.stringify(snapshot);
      if (
        snapshot.rows.length <= MAX_ROWS &&
        new TextEncoder().encode(text).byteLength <= MAX_BYTES
      ) {
        try {
          await kv.put(cacheKey, text, {
            expirationTtl: Math.max(60, Math.ceil((snapshot.expiresAt - Date.now()) / 1000)),
          });
        } catch {
          console.warn("Leaderboard cache write unavailable");
        }
      }
    }
    if ((await getLeaderboardRevision(db)) === revision && snapshot.expiresAt > Date.now())
      return snapshot;
  }
  throw new Error("Leaderboard changed during read");
}
