/**
 * L3 API E2E tests — hit real Next.js dev server on port 17020 with real D1.
 *
 * The server runs with E2E_SKIP_AUTH=true, so all requests are authenticated
 * as E2E_TEST_USER_ID without needing OAuth.
 *
 * To prevent concurrent CI runs from colliding on pew-db-test, the E2E runner
 * (scripts/run-e2e.ts) generates a unique E2E_TEST_USER_ID per run and passes
 * it via environment variables to both the Next.js server and this test file.
 *
 * Prerequisites:
 *   - Next.js dev server running on E2E_PORT (default 17020) with E2E_SKIP_AUTH=true
 *   - Cloudflare D1 credentials in .env.local
 *   - Use `bun run test:e2e` which handles server lifecycle automatically
 *
 * Test strategy:
 *   1. Before all: seed the E2E test user in D1
 *   2. Ingest tests: POST records and verify response
 *   3. Usage tests: GET and verify records + summary match ingested data
 *   4. CLI auth tests: GET /api/auth/cli and verify redirect with api_key
 *   5. After all: clean up test user + usage records from D1
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { D1Client } from "../../lib/d1";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const E2E_PORT = process.env.E2E_PORT || "17020";
const BASE_URL = `http://localhost:${E2E_PORT}`;

// Per-run unique user ID/email — set by scripts/run-e2e.ts to isolate
// concurrent CI runs sharing the same pew-db-test D1 database.
const TEST_USER_ID = process.env.E2E_TEST_USER_ID || "e2e-test-user-id";
const TEST_USER_EMAIL = process.env.E2E_TEST_USER_EMAIL || "e2e@test.local";

// Real GitHub repo URL — must point to an existing repository so that
// fetchGitHubMetadata() succeeds during showcase creation.
const SHOWCASE_REPO_URL = "https://github.com/nocoo/pew";
const SHOWCASE_REPO_KEY = "nocoo/pew";

/** Headers for ingest requests — includes version gate header */
const INGEST_HEADERS = {
  "Content-Type": "application/json",
  "X-Pew-Client-Version": "1.8.0",
};

// D1 client for direct DB access (seed/cleanup)
function getD1(): D1Client {
  return new D1Client({
    accountId: process.env.CF_ACCOUNT_ID ?? "",
    databaseId: process.env.CF_D1_DATABASE_ID ?? "",
    apiToken: process.env.CF_D1_API_TOKEN ?? "",
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedTestUser(d1: D1Client): Promise<void> {
  await d1.execute(
    `INSERT INTO users (id, email, name, created_at, updated_at)
     VALUES (?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT (id) DO UPDATE SET email = excluded.email`,
    [TEST_USER_ID, TEST_USER_EMAIL, "E2E Test User"],
  );
}

async function cleanupTestData(d1: D1Client): Promise<void> {
  // Delete in reverse FK order — child tables first, then users
  // Tables without ON DELETE CASCADE must be cleaned manually
  // Use try/catch per table to handle missing tables in test DB (schema drift)
  const tables = [
    { sql: "DELETE FROM badge_assignments WHERE user_id = ? OR assigned_by = ? OR revoked_by = ?", params: [TEST_USER_ID, TEST_USER_ID, TEST_USER_ID] },
    { sql: "DELETE FROM showcase_votes WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM showcases WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM season_team_members WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM season_leaderboard WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM device_aliases WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM session_records WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM usage_records WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM accounts WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM users WHERE id = ?", params: [TEST_USER_ID] },
  ];

  for (const { sql, params } of tables) {
    try {
      await d1.execute(sql, params);
    } catch (err) {
      // Ignore "no such table" errors — test DB may not have all tables
      if (!(err instanceof Error && err.message.includes("no such table"))) {
        throw err;
      }
    }
  }
}

function makeRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    source: "claude-code",
    model: "claude-sonnet-4-20250514",
    hour_start: "2026-03-01T10:00:00.000Z",
    input_tokens: 1000,
    cached_input_tokens: 200,
    output_tokens: 500,
    reasoning_output_tokens: 0,
    total_tokens: 1700,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

const d1 = getD1();

beforeAll(async () => {
  // Clean any leftover data, then seed
  await cleanupTestData(d1);
  await seedTestUser(d1);
});

afterAll(async () => {
  await cleanupTestData(d1);
});

// ===========================================================================
// POST /api/ingest
// ===========================================================================

describe("POST /api/ingest", () => {
  it("should reject requests without client version header", async () => {
    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([makeRecord()]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("version");
  });

  it("should reject empty array", async () => {
    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify([]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("empty");
  });

  it("should reject non-array body", async () => {
    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify({ source: "claude-code" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("array");
  });

  it("should reject invalid source", async () => {
    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify([makeRecord({ source: "invalid-tool" })]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("invalid source");
  });

  it("should reject negative tokens", async () => {
    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify([makeRecord({ input_tokens: -1 })]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("input_tokens");
  });

  it("should ingest a single record", async () => {
    const record = makeRecord();
    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify([record]),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ingested).toBe(1);

    // Verify in D1 directly
    const row = await d1.firstOrNull<{ total_tokens: number }>(
      `SELECT total_tokens FROM usage_records
       WHERE user_id = ? AND source = ? AND model = ? AND hour_start = ?`,
      [TEST_USER_ID, record.source, record.model, record.hour_start],
    );
    expect(row).not.toBeNull();
    expect(row!.total_tokens).toBe(1700);
  });

  it("should upsert (overwrite tokens) on conflict", async () => {
    // Ingest the same record again — tokens should be overwritten, not added
    const record = makeRecord();
    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify([record]),
    });
    expect(res.status).toBe(200);

    // Total should still be 1700 (overwrite, not 1700 + 1700)
    const row = await d1.firstOrNull<{ total_tokens: number }>(
      `SELECT total_tokens FROM usage_records
       WHERE user_id = ? AND source = ? AND model = ? AND hour_start = ?`,
      [TEST_USER_ID, record.source, record.model, record.hour_start],
    );
    expect(row!.total_tokens).toBe(1700);
  });

  it("should ingest multiple records in a batch", async () => {
    const records = [
      makeRecord({
        source: "gemini-cli",
        model: "gemini-2.5-pro",
        hour_start: "2026-03-01T11:00:00.000Z",
        input_tokens: 500,
        cached_input_tokens: 100,
        output_tokens: 200,
        reasoning_output_tokens: 50,
        total_tokens: 850,
      }),
      makeRecord({
        source: "opencode",
        model: "gpt-4o",
        hour_start: "2026-03-01T11:30:00.000Z",
        input_tokens: 800,
        cached_input_tokens: 0,
        output_tokens: 400,
        reasoning_output_tokens: 100,
        total_tokens: 1300,
      }),
    ];

    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify(records),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ingested).toBe(2);
  });
});

// ===========================================================================
// GET /api/usage
// ===========================================================================

describe("GET /api/usage", () => {
  it("should return records for the test user", async () => {
    const res = await fetch(
      `${BASE_URL}/api/usage?from=2026-03-01&to=2026-03-02`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // We have 3 distinct records: claude-code, gemini-cli, opencode
    expect(body.records.length).toBe(3);
    expect(body.summary).toBeDefined();
    // Total = 1700 (claude overwritten) + 850 (gemini) + 1300 (opencode) = 3850
    expect(body.summary.total_tokens).toBe(3850);
  });

  it("should filter by source", async () => {
    const res = await fetch(
      `${BASE_URL}/api/usage?from=2026-03-01&to=2026-03-02&source=gemini-cli`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.records.length).toBe(1);
    expect(body.records[0].source).toBe("gemini-cli");
    expect(body.summary.total_tokens).toBe(850);
  });

  it("should aggregate by day granularity", async () => {
    const res = await fetch(
      `${BASE_URL}/api/usage?from=2026-03-01&to=2026-03-02&granularity=day`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // All 3 records are on 2026-03-01, but different source/model combos
    // Day granularity groups by date(hour_start), source, model
    expect(body.records.length).toBe(3);
    // All hour_start fields should be the date (day granularity)
    for (const r of body.records) {
      expect(r.hour_start).toBe("2026-03-01");
    }
  });

  it("should reject invalid source filter", async () => {
    const res = await fetch(`${BASE_URL}/api/usage?source=invalid`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid source");
  });

  it("should reject invalid granularity", async () => {
    const res = await fetch(`${BASE_URL}/api/usage?granularity=weekly`);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid granularity");
  });

  it("should return empty when date range has no data", async () => {
    const res = await fetch(
      `${BASE_URL}/api/usage?from=2020-01-01&to=2020-01-02`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.records.length).toBe(0);
    expect(body.summary.total_tokens).toBe(0);
  });
});

// ===========================================================================
// GET /api/auth/cli
// ===========================================================================

describe("GET /api/auth/cli", () => {
  it("should return 400 when callback is missing", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/cli`, {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("callback");
  });

  it("should return 400 for invalid callback URL", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/cli?callback=not-a-url`, {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("Invalid callback");
  });

  it("should return 400 for non-localhost callback", async () => {
    const res = await fetch(
      `${BASE_URL}/api/auth/cli?callback=https://evil.com/cb`,
      { redirect: "manual" },
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("localhost");
  });

  it("should redirect to localhost callback with api_key", async () => {
    const callback = "http://localhost:19876/callback";
    const res = await fetch(
      `${BASE_URL}/api/auth/cli?callback=${encodeURIComponent(callback)}`,
      { redirect: "manual" },
    );

    // Should be a redirect (307 from NextResponse.redirect)
    expect(res.status).toBe(307);
    const location = res.headers.get("Location");
    expect(location).toBeTruthy();

    const redirectUrl = new URL(location!);
    expect(redirectUrl.hostname).toBe("localhost");
    expect(redirectUrl.port).toBe("19876");
    expect(redirectUrl.pathname).toBe("/callback");

    // Should have api_key in query params
    const apiKey = redirectUrl.searchParams.get("api_key");
    expect(apiKey).toBeTruthy();
    expect(apiKey!).toMatch(/^pk_[a-f0-9]{32}$/);

    // Should have email in query params
    const email = redirectUrl.searchParams.get("email");
    expect(email).toBe(TEST_USER_EMAIL);
  });

  it("should return same api_key on subsequent calls", async () => {
    const callback = "http://localhost:19876/callback";
    const res1 = await fetch(
      `${BASE_URL}/api/auth/cli?callback=${encodeURIComponent(callback)}`,
      { redirect: "manual" },
    );
    const res2 = await fetch(
      `${BASE_URL}/api/auth/cli?callback=${encodeURIComponent(callback)}`,
      { redirect: "manual" },
    );

    const url1 = new URL(res1.headers.get("Location")!);
    const url2 = new URL(res2.headers.get("Location")!);

    expect(url1.searchParams.get("api_key")).toBe(
      url2.searchParams.get("api_key"),
    );
  });
});

// ===========================================================================
// Showcase API E2E Tests
// ===========================================================================

/**
 * beforeAll crash-recovery cleanup: remove stale rows by repo_key (from
 * crashed CI runs) AND by user_id. Safe because no other run is relying
 * on this data yet — we haven't started our tests.
 */
async function cleanupShowcasesBefore(d1: D1Client): Promise<void> {
  // 1. Remove stale rows left by crashed CI runs that used the same fixed
  //    repo_key (UNIQUE constraint). This must run first so the current run
  //    can INSERT the key without a 409 conflict.
  await d1.execute(
    "DELETE FROM showcase_upvotes WHERE showcase_id IN (SELECT id FROM showcases WHERE repo_key = ?)",
    [SHOWCASE_REPO_KEY],
  );
  await d1.execute("DELETE FROM showcases WHERE repo_key = ?", [
    SHOWCASE_REPO_KEY,
  ]);

  // 2. Clean up any other test data owned by this run's TEST_USER_ID.
  await d1.execute("DELETE FROM showcase_upvotes WHERE user_id = ?", [
    TEST_USER_ID,
  ]);
  await d1.execute(
    "DELETE FROM showcase_upvotes WHERE showcase_id IN (SELECT id FROM showcases WHERE user_id = ?)",
    [TEST_USER_ID],
  );
  await d1.execute("DELETE FROM showcases WHERE user_id = ?", [TEST_USER_ID]);
}

/**
 * afterAll cleanup: ONLY delete by user_id. Do NOT delete by repo_key here
 * because a concurrent run may have already created a new row with the same
 * repo_key — deleting it would break that run's assertions.
 */
async function cleanupShowcasesAfter(d1: D1Client): Promise<void> {
  await d1.execute("DELETE FROM showcase_upvotes WHERE user_id = ?", [
    TEST_USER_ID,
  ]);
  await d1.execute(
    "DELETE FROM showcase_upvotes WHERE showcase_id IN (SELECT id FROM showcases WHERE user_id = ?)",
    [TEST_USER_ID],
  );
  await d1.execute("DELETE FROM showcases WHERE user_id = ?", [TEST_USER_ID]);
}

/** Helper to create a showcase and return its ID.
 *  If a 409 is returned (another concurrent run already owns the repo_key),
 *  look up the existing row in D1 and reuse its ID instead of failing. */
async function createTestShowcase(
  repoUrl: string,
  tagline?: string,
): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/showcases`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      github_url: repoUrl,
      tagline,
    }),
  });
  if (res.status === 201) {
    const body = await res.json();
    return body.id;
  }
  if (res.status === 409) {
    // Another run created the showcase between our cleanup and create.
    // Fetch the existing row from D1 and reuse it.
    const existing = await d1.firstOrNull<{ id: string }>(
      "SELECT id FROM showcases WHERE repo_key = ?",
      [SHOWCASE_REPO_KEY],
    );
    if (existing) return existing.id;
    // If somehow not found after 409, fall through to throw
  }
  const body = await res.json();
  throw new Error(`Failed to create showcase: ${body.error}`);
}

/** Helper to assert showcase tests should run - throws if rate limited */
function requireShowcase(id: string | null, skipFlag: boolean): asserts id is string {
  if (skipFlag || !id) {
    throw new Error("SKIPPED: GitHub API rate limited — showcase not created");
  }
}

describe("Showcase API", () => {
  // Shared showcase ID — created once, used by multiple tests
  let sharedShowcaseId: string | null = null;
  let skipShowcaseTests = false;

  // Clean up any leftover showcase data and create ONE shared showcase
  beforeAll(async () => {
    await cleanupShowcasesBefore(d1);
    // Try to create a single showcase (1 GitHub API call)
    // If rate limited, mark tests to skip
    try {
      sharedShowcaseId = await createTestShowcase(
        SHOWCASE_REPO_URL,
        "E2E test showcase",
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("rate limit")) {
        console.warn("⚠️  GitHub API rate limited — showcase-dependent tests will fail with SKIPPED");
        skipShowcaseTests = true;
      } else {
        throw err;
      }
    }
  });

  // Clean up showcases after all showcase tests — only by user_id (safe)
  afterAll(async () => {
    await cleanupShowcasesAfter(d1);
  });

  // -------------------------------------------------------------------------
  // POST /api/showcases/preview — validation only (no GitHub API needed)
  // -------------------------------------------------------------------------

  describe("POST /api/showcases/preview", () => {
    it("should return 400 for invalid URL format", async () => {
      const res = await fetch(`${BASE_URL}/api/showcases/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ github_url: "https://github.com/nocoo" }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid");
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/showcases (create) — validation tests only
  // -------------------------------------------------------------------------

  describe("POST /api/showcases", () => {
    it("should return 409 for duplicate repo (using shared showcase)", async () => {
      requireShowcase(sharedShowcaseId, skipShowcaseTests);
      // The shared showcase already uses SHOWCASE_REPO_KEY, so this should 409
      const res = await fetch(`${BASE_URL}/api/showcases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          github_url: SHOWCASE_REPO_URL,
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toContain("already");
    });

    it("should return 400 for tagline over 280 chars", async () => {
      const res = await fetch(`${BASE_URL}/api/showcases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          github_url: "https://github.com/vercel/next.js",
          tagline: "x".repeat(281),
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("280");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/showcases (list) — uses shared showcase
  // -------------------------------------------------------------------------

  describe("GET /api/showcases", () => {
    it("should list public showcases", async () => {
      requireShowcase(sharedShowcaseId, skipShowcaseTests);
      const res = await fetch(`${BASE_URL}/api/showcases`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(Array.isArray(body.showcases)).toBe(true);
      expect(typeof body.total).toBe("number");
      expect(body.total).toBeGreaterThanOrEqual(1);

      // Find our shared showcase
      const ourShowcase = body.showcases.find(
        (s: { id: string }) => s.id === sharedShowcaseId,
      );
      expect(ourShowcase).toBeTruthy();
      expect(ourShowcase.user).toBeTruthy();
      expect(ourShowcase.user.id).toBe(TEST_USER_ID);
    });

    it("should return mine=1 showcases for authenticated user", async () => {
      requireShowcase(sharedShowcaseId, skipShowcaseTests);
      const res = await fetch(`${BASE_URL}/api/showcases?mine=1`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.showcases.length).toBeGreaterThanOrEqual(1);
      // All should belong to test user
      for (const s of body.showcases) {
        expect(s.user.id).toBe(TEST_USER_ID);
      }
    });

    it("should respect limit and offset", async () => {
      const res = await fetch(`${BASE_URL}/api/showcases?limit=1&offset=0`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.showcases.length).toBeLessThanOrEqual(1);
      expect(body.limit).toBe(1);
      expect(body.offset).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/showcases/[id] (single) — uses shared showcase
  // -------------------------------------------------------------------------

  describe("GET /api/showcases/[id]", () => {
    it("should return single showcase", async () => {
      requireShowcase(sharedShowcaseId, skipShowcaseTests);
      const res = await fetch(`${BASE_URL}/api/showcases/${sharedShowcaseId}`);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.id).toBe(sharedShowcaseId);
      expect(body.repo_key).toBe(SHOWCASE_REPO_KEY);
      expect(body.user.id).toBe(TEST_USER_ID);
    });

    it("should return 404 for non-existent showcase", async () => {
      const res = await fetch(`${BASE_URL}/api/showcases/non-existent-id`);
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/showcases/[id] (update) — uses shared showcase
  // -------------------------------------------------------------------------

  describe("PATCH /api/showcases/[id]", () => {
    it("should update tagline", async () => {
      requireShowcase(sharedShowcaseId, skipShowcaseTests);
      const res = await fetch(`${BASE_URL}/api/showcases/${sharedShowcaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagline: "Updated tagline for testing" }),
      });
      expect(res.status).toBe(200);

      // Verify update
      const getRes = await fetch(`${BASE_URL}/api/showcases/${sharedShowcaseId}`);
      const body = await getRes.json();
      expect(body.tagline).toBe("Updated tagline for testing");
    });

    it("should update visibility", async () => {
      requireShowcase(sharedShowcaseId, skipShowcaseTests);
      const res = await fetch(`${BASE_URL}/api/showcases/${sharedShowcaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: false }),
      });
      expect(res.status).toBe(200);

      // Verify in DB (hidden showcase still visible to owner)
      const row = await d1.firstOrNull<{ is_public: number }>(
        "SELECT is_public FROM showcases WHERE id = ?",
        [sharedShowcaseId],
      );
      expect(row!.is_public).toBe(0);

      // Restore visibility for other tests
      await fetch(`${BASE_URL}/api/showcases/${sharedShowcaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_public: true }),
      });
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/showcases/[id]/upvote (toggle) — uses shared showcase
  // -------------------------------------------------------------------------

  describe("POST /api/showcases/[id]/upvote", () => {
    it("should add upvote", async () => {
      requireShowcase(sharedShowcaseId, skipShowcaseTests);
      const res = await fetch(`${BASE_URL}/api/showcases/${sharedShowcaseId}/upvote`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.upvoted).toBe(true);
      expect(body.upvote_count).toBe(1);

      // Verify in D1
      const row = await d1.firstOrNull<{ id: number }>(
        "SELECT id FROM showcase_upvotes WHERE showcase_id = ? AND user_id = ?",
        [sharedShowcaseId, TEST_USER_ID],
      );
      expect(row).not.toBeNull();
    });

    it("should remove upvote on second call (toggle)", async () => {
      requireShowcase(sharedShowcaseId, skipShowcaseTests);
      const res = await fetch(`${BASE_URL}/api/showcases/${sharedShowcaseId}/upvote`, {
        method: "POST",
      });
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.upvoted).toBe(false);
      expect(body.upvote_count).toBe(0);
    });

    it("should return 404 for non-existent showcase", async () => {
      const res = await fetch(`${BASE_URL}/api/showcases/non-existent/upvote`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/showcases/[id]/refresh — skipped (hits GitHub API)
  // -------------------------------------------------------------------------

  describe("POST /api/showcases/[id]/refresh", () => {
    it("should return 404 for non-existent showcase", async () => {
      const res = await fetch(`${BASE_URL}/api/showcases/non-existent/refresh`, {
        method: "POST",
      });
      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /api/showcases/[id] — uses shared showcase (last test)
  // -------------------------------------------------------------------------

  describe("DELETE /api/showcases/[id]", () => {
    it("should delete the shared showcase", async () => {
      requireShowcase(sharedShowcaseId, skipShowcaseTests);
      // Delete the shared showcase (last test, so it's safe)
      const deleteRes = await fetch(`${BASE_URL}/api/showcases/${sharedShowcaseId}`, {
        method: "DELETE",
      });
      expect(deleteRes.status).toBe(200);

      // Verify deleted
      const row = await d1.firstOrNull<{ id: string }>(
        "SELECT id FROM showcases WHERE id = ?",
        [sharedShowcaseId],
      );
      expect(row).toBeNull();
    });

    it("should return 404 for non-existent showcase", async () => {
      const res = await fetch(`${BASE_URL}/api/showcases/non-existent`, {
        method: "DELETE",
      });
      expect(res.status).toBe(404);
    });
  });
});
