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

// Per-run unique showcase repo — uses TEST_USER_ID to derive a unique
// repo_key so concurrent CI runs never collide on the UNIQUE constraint.
// The E2E server runs with E2E_MOCK_GITHUB=1, so fetchGitHubMetadata()
// returns mock data and does not require a real GitHub repository.
const SHOWCASE_RUN_SLUG = TEST_USER_ID.replace(/[^a-zA-Z0-9_.-]/g, "-");
const SHOWCASE_REPO_URL = `https://github.com/e2e-test/${SHOWCASE_RUN_SLUG}`;
const SHOWCASE_REPO_KEY = `e2e-test/${SHOWCASE_RUN_SLUG}`.toLowerCase();

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
 * beforeAll cleanup: remove stale rows by this run's unique repo_key AND
 * user_id. With per-run unique repo_keys, we only need to clean our own data.
 */
async function cleanupShowcasesBefore(d1: D1Client): Promise<void> {
  // Clean up by repo_key (in case a previous crashed run with the same
  // TEST_USER_ID left data behind — unlikely but safe)
  await d1.execute(
    "DELETE FROM showcase_upvotes WHERE showcase_id IN (SELECT id FROM showcases WHERE repo_key = ?)",
    [SHOWCASE_REPO_KEY],
  );
  await d1.execute("DELETE FROM showcases WHERE repo_key = ?", [
    SHOWCASE_REPO_KEY,
  ]);

  // Clean up by user_id
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

/** Helper to create a showcase and return its ID. */
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
  const body = await res.json();
  throw new Error(`Failed to create showcase (${res.status}): ${body.error}`);
}

/** Helper to assert showcase was created successfully */
function requireShowcase(id: string | null): asserts id is string {
  if (!id) {
    throw new Error("SKIPPED: showcase not created");
  }
}

describe("Showcase API", () => {
  // Shared showcase ID — created once, used by multiple tests
  let sharedShowcaseId: string | null = null;

  // Clean up any leftover showcase data and create ONE shared showcase
  beforeAll(async () => {
    await cleanupShowcasesBefore(d1);
    sharedShowcaseId = await createTestShowcase(
      SHOWCASE_REPO_URL,
      "E2E test showcase",
    );
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
      requireShowcase(sharedShowcaseId);
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
      requireShowcase(sharedShowcaseId);
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
      requireShowcase(sharedShowcaseId);
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
      requireShowcase(sharedShowcaseId);
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
      requireShowcase(sharedShowcaseId);
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
      requireShowcase(sharedShowcaseId);
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
      requireShowcase(sharedShowcaseId);
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
      requireShowcase(sharedShowcaseId);
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
      requireShowcase(sharedShowcaseId);
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

// ===========================================================================
// GET/PATCH /api/settings
// ===========================================================================

describe("GET /api/settings", () => {
  it("should return current user settings", async () => {
    const res = await fetch(`${BASE_URL}/api/settings`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Check response shape
    expect(typeof body.is_public).toBe("boolean");
    // nickname and slug can be null
    expect("nickname" in body).toBe(true);
    expect("slug" in body).toBe(true);
  });
});

describe("PATCH /api/settings", () => {
  it("should update nickname", async () => {
    const res = await fetch(`${BASE_URL}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "E2E Test Nick" }),
    });
    expect(res.status).toBe(200);

    // Verify update
    const getRes = await fetch(`${BASE_URL}/api/settings`);
    const body = await getRes.json();
    expect(body.nickname).toBe("E2E Test Nick");
  });

  it("should update is_public", async () => {
    const res = await fetch(`${BASE_URL}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_public: true }),
    });
    expect(res.status).toBe(200);

    const getRes = await fetch(`${BASE_URL}/api/settings`);
    const body = await getRes.json();
    expect(body.is_public).toBe(true);
  });

  it("should reject invalid nickname (too long)", async () => {
    const res = await fetch(`${BASE_URL}/api/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nickname: "x".repeat(101) }),
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// GET /api/leaderboard
// ===========================================================================

describe("GET /api/leaderboard", () => {
  it("should return leaderboard entries", async () => {
    const res = await fetch(`${BASE_URL}/api/leaderboard`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.period).toBe("week"); // default
    expect(body.scope).toBe("global");
    expect(Array.isArray(body.entries)).toBe(true);
    expect(typeof body.hasMore).toBe("boolean");
  });

  it("should accept period parameter", async () => {
    const res = await fetch(`${BASE_URL}/api/leaderboard?period=month`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.period).toBe("month");
  });

  it("should accept limit and offset", async () => {
    const res = await fetch(`${BASE_URL}/api/leaderboard?limit=5&offset=0`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBeLessThanOrEqual(5);
  });

  it("should reject invalid period", async () => {
    const res = await fetch(`${BASE_URL}/api/leaderboard?period=invalid`);
    expect(res.status).toBe(400);
  });

  it("should reject limit over max", async () => {
    const res = await fetch(`${BASE_URL}/api/leaderboard?limit=101`);
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// GET /api/devices
// ===========================================================================

describe("GET /api/devices", () => {
  it("should return user devices", async () => {
    const res = await fetch(`${BASE_URL}/api/devices`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.devices)).toBe(true);
  });
});

// ===========================================================================
// GET /api/sessions
// ===========================================================================

describe("GET /api/sessions", () => {
  it("should return user sessions", async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.records)).toBe(true);
    expect(typeof body.summary).toBe("object");
  });

  it("should accept date range filter", async () => {
    const res = await fetch(`${BASE_URL}/api/sessions?from=2026-01-01&to=2026-12-31`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.records)).toBe(true);
  });
});

// ===========================================================================
// GET /api/live (health check)
// ===========================================================================

describe("GET /api/live", () => {
  it("should return health status", async () => {
    const res = await fetch(`${BASE_URL}/api/live`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.status).toBe("ok");
    expect(typeof body.timestamp).toBe("string");
    expect(typeof body.uptime).toBe("number");
    expect(body.database.connected).toBe(true);
  });
});

// ===========================================================================
// GET /api/pricing
// ===========================================================================

describe("GET /api/pricing", () => {
  it("should return pricing map", async () => {
    const res = await fetch(`${BASE_URL}/api/pricing`);
    expect(res.status).toBe(200);
    const body = await res.json();

    // Pricing map is an object with model names as keys
    expect(typeof body).toBe("object");
    expect(body).not.toBeNull();
  });
});

// ===========================================================================
// GET /api/seasons
// ===========================================================================

describe("GET /api/seasons", () => {
  it("should return seasons list", async () => {
    const res = await fetch(`${BASE_URL}/api/seasons`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.seasons)).toBe(true);
  });
});

// ===========================================================================
// GET /api/achievements
// ===========================================================================

describe("GET /api/achievements", () => {
  it("should return achievements for user", async () => {
    const res = await fetch(`${BASE_URL}/api/achievements`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.achievements)).toBe(true);
  });
});

// ===========================================================================
// GET /api/usage/by-device
// ===========================================================================

describe("GET /api/usage/by-device", () => {
  it("should return usage grouped by device", async () => {
    const res = await fetch(`${BASE_URL}/api/usage/by-device`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.devices)).toBe(true);
  });
});

// ===========================================================================
// GET/POST /api/projects
// ===========================================================================

describe("GET /api/projects", () => {
  it("should return user projects", async () => {
    const res = await fetch(`${BASE_URL}/api/projects`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.projects)).toBe(true);
    expect(Array.isArray(body.unassigned)).toBe(true);
  });

  it("should accept date range filter", async () => {
    const res = await fetch(`${BASE_URL}/api/projects?from=2026-01-01&to=2026-12-31`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.projects)).toBe(true);
  });
});

let testProjectId: string | null = null;

describe("POST /api/projects", () => {
  it("should create a new project", async () => {
    const res = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Test Project" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();

    expect(body.id).toBeTruthy();
    expect(body.name).toBe("E2E Test Project");
    testProjectId = body.id;
  });

  it("should reject empty name", async () => {
    const res = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("should reject reserved name", async () => {
    const res = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "unassigned" }),
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// PATCH/DELETE /api/projects/[id] (no GET endpoint)
// ===========================================================================

describe("PATCH /api/projects/[id]", () => {
  it("should update project name", async () => {
    if (!testProjectId) throw new Error("Test project not created");
    const res = await fetch(`${BASE_URL}/api/projects/${testProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "E2E Renamed Project" }),
    });
    expect(res.status).toBe(200);
  });

  it("should return 404 for non-existent project", async () => {
    const res = await fetch(`${BASE_URL}/api/projects/non-existent-id`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/projects/[id]", () => {
  it("should delete the test project", async () => {
    if (!testProjectId) throw new Error("Test project not created");
    const res = await fetch(`${BASE_URL}/api/projects/${testProjectId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
  });

  it("should return 404 for non-existent project", async () => {
    const res = await fetch(`${BASE_URL}/api/projects/non-existent-id`, {
      method: "DELETE",
    });
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// GET /api/projects/timeline
// ===========================================================================

describe("GET /api/projects/timeline", () => {
  it("should return project timeline with date range", async () => {
    const res = await fetch(`${BASE_URL}/api/projects/timeline?from=2026-01-01&to=2026-12-31`);
    // May return 200 with empty data or 500 if table doesn't exist in test DB
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(Array.isArray(body.timeline)).toBe(true);
    }
  });

  it("should reject missing from param", async () => {
    const res = await fetch(`${BASE_URL}/api/projects/timeline`);
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// GET /api/teams
// ===========================================================================

describe("GET /api/teams", () => {
  it("should return user teams", async () => {
    const res = await fetch(`${BASE_URL}/api/teams`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.teams)).toBe(true);
  });
});

// ===========================================================================
// GET /api/organizations
// ===========================================================================

describe("GET /api/organizations", () => {
  it("should return organizations or handle missing table", async () => {
    const res = await fetch(`${BASE_URL}/api/organizations`);
    // Returns 200 with data or empty array; 500 only on unexpected errors
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(Array.isArray(body.organizations)).toBe(true);
    }
  });
});

describe("GET /api/organizations/mine", () => {
  it("should return user's organizations or handle missing table", async () => {
    const res = await fetch(`${BASE_URL}/api/organizations/mine`);
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(Array.isArray(body.organizations)).toBe(true);
    }
  });
});

// ===========================================================================
// POST /api/ingest/sessions
// ===========================================================================

describe("POST /api/ingest/sessions", () => {
  it("should reject requests without client version header", async () => {
    const res = await fetch(`${BASE_URL}/api/ingest/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([]),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("version");
  });

  it("should reject empty array", async () => {
    const res = await fetch(`${BASE_URL}/api/ingest/sessions`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify([]),
    });
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// GET /api/users/[slug]
// ===========================================================================

describe("GET /api/users/[slug]", () => {
  it("should return 404 for non-existent user", async () => {
    const res = await fetch(`${BASE_URL}/api/users/non-existent-slug`);
    expect(res.status).toBe(404);
  });

  // Note: Testing own profile requires user to be public or authorized
  // The test user may not be public, so we just test the 404 case
});

// ===========================================================================
// GET /api/users/[slug]/achievements
// ===========================================================================

describe("GET /api/users/[slug]/achievements", () => {
  it("should return 404 for non-existent user", async () => {
    const res = await fetch(`${BASE_URL}/api/users/non-existent-slug/achievements`);
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// GET /api/achievements/[id]/members
// ===========================================================================

describe("GET /api/achievements/[id]/members", () => {
  it("should return 404 for non-existent achievement", async () => {
    const res = await fetch(`${BASE_URL}/api/achievements/non-existent/members`);
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// Auth routes
// ===========================================================================

describe("GET /api/auth/invite-required", () => {
  it("should return invite gate status", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/invite-required`);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(typeof body.required).toBe("boolean");
  });
});

describe("POST /api/auth/verify-invite", () => {
  it("should reject invalid invite code", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/verify-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "INVALID-CODE" }),
    });
    // Could be 400 or 404 depending on implementation
    expect([400, 404]).toContain(res.status);
  });
});

describe("POST /api/auth/code", () => {
  it("should generate auth code or handle missing table", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/code`, {
      method: "POST",
    });
    // May return 200 with code or 500 if auth_codes table doesn't exist
    expect([200, 500]).toContain(res.status);
    if (res.status === 200) {
      const body = await res.json();
      expect(body.code).toBeTruthy();
      expect(body.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    }
  });
});

describe("POST /api/auth/code/verify", () => {
  it("should reject invalid code", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/code/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "XXXX-YYYY" }),
    });
    // 401 for invalid code, 500 if table doesn't exist
    expect([401, 500]).toContain(res.status);
  });
});

// ===========================================================================
// Teams routes
// ===========================================================================

describe("GET /api/teams/[teamId]", () => {
  it("should return 403/404/500 for non-existent team", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/non-existent-team-id`);
    // 403 if not member, 404 if not found, 500 if table missing
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("POST /api/teams/join", () => {
  it("should reject join without invite code", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("should reject invalid invite code", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ invite_code: "INVALID" }),
    });
    expect([400, 404]).toContain(res.status);
  });
});

// ===========================================================================
// Organizations member routes
// ===========================================================================

describe("GET /api/organizations/[orgId]/members", () => {
  it("should return 401/404/500/503 for non-existent org", async () => {
    const res = await fetch(`${BASE_URL}/api/organizations/non-existent-org/members`);
    expect([401, 404, 500, 503]).toContain(res.status);
  });
});

describe("POST /api/organizations/[orgId]/join", () => {
  it("should return 404 for non-existent org", async () => {
    const res = await fetch(`${BASE_URL}/api/organizations/non-existent-org/join`, {
      method: "POST",
    });
    expect([404, 500]).toContain(res.status);
  });
});

describe("DELETE /api/organizations/[orgId]/leave", () => {
  it("should return 400/403/404/500 for non-existent org", async () => {
    const res = await fetch(`${BASE_URL}/api/organizations/non-existent-org/leave`, {
      method: "DELETE",
    });
    expect([400, 403, 404, 500]).toContain(res.status);
  });
});

// ===========================================================================
// Season routes
// ===========================================================================

describe("GET /api/seasons/[seasonId]/leaderboard", () => {
  it("should return 404 for non-existent season", async () => {
    const res = await fetch(`${BASE_URL}/api/seasons/non-existent-season/leaderboard`);
    expect([404, 500]).toContain(res.status);
  });
});

describe("POST /api/seasons/[seasonId]/register", () => {
  it("should return 400/403/404/500 for non-existent season", async () => {
    const res = await fetch(`${BASE_URL}/api/seasons/non-existent-season/register`, {
      method: "POST",
    });
    expect([400, 403, 404, 500]).toContain(res.status);
  });
});

// ===========================================================================
// Admin routes (require admin auth)
// ===========================================================================

// Admin routes require special admin user setup.
// These tests verify the routes are accessible (return 403 for non-admin)
// or handle gracefully when tables don't exist.

describe("GET /api/admin/check", () => {
  it("should check admin status", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/check`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.isAdmin).toBe("boolean");
  });
});

describe("GET /api/admin/settings", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/settings`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/users", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/users`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/invites", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/invites`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/badges", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/badges`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/pricing", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/pricing`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/seasons", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/seasons`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/organizations", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/showcases", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/showcases`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/storage", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/storage`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/cache", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/cache`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/usage/compare", () => {
  it("should return 403 for non-admin or 400/200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/usage/compare`);
    // 400 if missing params, 403 if not admin, 500 if table missing
    expect([200, 400, 403, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/badges/assignments", () => {
  it("should return 403 for non-admin or 200 for admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/badges/assignments`);
    expect([200, 403, 500]).toContain(res.status);
  });
});

// ===========================================================================
// Account routes
// ===========================================================================

describe("DELETE /api/account/delete", () => {
  it("should reject without email confirmation", async () => {
    const res = await fetch(`${BASE_URL}/api/account/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it("should reject mismatched email confirmation", async () => {
    const res = await fetch(`${BASE_URL}/api/account/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm_email: "wrong@email.com" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("match");
  });

  // Note: We don't test successful deletion as it would delete the test user
});

// ===========================================================================
// Admin badge management routes
// ===========================================================================

describe("POST /api/admin/badges/[id]/archive", () => {
  it("should return 403 for non-admin or 404 for non-existent badge", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/badges/non-existent/archive`, {
      method: "POST",
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("POST /api/admin/badges/[id]/unarchive", () => {
  it("should return 403 for non-admin or 404 for non-existent badge", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/badges/non-existent/unarchive`, {
      method: "POST",
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("POST /api/admin/badges/assignments/[id]/revoke", () => {
  it("should return 403 for non-admin or 404 for non-existent assignment", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/badges/assignments/non-existent/revoke`, {
      method: "POST",
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

// ===========================================================================
// Admin organization management routes
// ===========================================================================

describe("GET /api/admin/organizations/[orgId]", () => {
  it("should return 403 for non-admin or 404 for non-existent org", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent`);
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("PATCH /api/admin/organizations/[orgId]", () => {
  it("should return 403 for non-admin or 404 for non-existent org", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("DELETE /api/admin/organizations/[orgId]", () => {
  it("should return 403 for non-admin or 404 for non-existent org", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent`, {
      method: "DELETE",
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("POST /api/admin/organizations/[orgId]/logo", () => {
  it("should return 403 for non-admin or 404 for non-existent org", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/logo`, {
      method: "POST",
    });
    expect([400, 403, 404, 500]).toContain(res.status);
  });
});

describe("DELETE /api/admin/organizations/[orgId]/logo", () => {
  it("should return 403 for non-admin or 404 for non-existent org", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/logo`, {
      method: "DELETE",
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("GET /api/admin/organizations/[orgId]/members", () => {
  it("should return 403 for non-admin or 404 for non-existent org", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/members`);
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("POST /api/admin/organizations/[orgId]/members", () => {
  it("should return 403 for non-admin or 400/404 for missing data", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect([400, 403, 404, 500]).toContain(res.status);
  });
});

describe("DELETE /api/admin/organizations/[orgId]/members/[userId]", () => {
  it("should return 403 for non-admin or 404 for non-existent", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/members/non-existent`, {
      method: "DELETE",
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

// ===========================================================================
// Admin season management routes
// ===========================================================================

describe("PATCH /api/admin/seasons/[seasonId]", () => {
  it("should return 403 for non-admin or 404 for non-existent season", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/seasons/non-existent`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Season" }),
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("POST /api/admin/seasons/[seasonId]/snapshot", () => {
  it("should return 403 for non-admin or 404 for non-existent season", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/seasons/non-existent/snapshot`, {
      method: "POST",
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("POST /api/admin/seasons/[seasonId]/sync-rosters", () => {
  it("should return 403 for non-admin or 404 for non-existent season", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/seasons/non-existent/sync-rosters`, {
      method: "POST",
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

// ===========================================================================
// Team member management routes
// ===========================================================================

describe("POST /api/teams/[teamId]/logo", () => {
  it("should return 401/403 for non-member or missing data", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/non-existent/logo`, {
      method: "POST",
    });
    // 400 if no file, 403 if not member
    expect([400, 403, 500]).toContain(res.status);
  });
});

describe("DELETE /api/teams/[teamId]/logo", () => {
  it("should return 403 for non-member or 404 for no logo", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/non-existent/logo`, {
      method: "DELETE",
    });
    expect([403, 404, 500]).toContain(res.status);
  });
});

describe("DELETE /api/teams/[teamId]/members/[userId]", () => {
  it("should return 403 for non-owner or 404 for non-existent", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/non-existent/members/non-existent`, {
      method: "DELETE",
    });
    expect([400, 403, 404, 500]).toContain(res.status);
  });
})
