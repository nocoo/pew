/**
 * L3 API E2E tests — hit real Next.js dev server on port 17030 with real D1.
 *
 * The server runs with E2E_SKIP_AUTH=true, so all requests are authenticated
 * as E2E_TEST_USER_ID ("e2e-test-user-id") without needing OAuth.
 *
 * Prerequisites:
 *   - Next.js dev server running on E2E_PORT (default 17030) with E2E_SKIP_AUTH=true
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

const E2E_PORT = process.env.E2E_PORT || "17030";
const BASE_URL = `http://localhost:${E2E_PORT}`;

const TEST_USER_ID = "e2e-test-user-id";
const TEST_USER_EMAIL = "e2e@test.local";

/** Headers for ingest requests — includes version gate header */
const INGEST_HEADERS = {
  "Content-Type": "application/json",
  "X-Pew-Client-Version": "1.7.0",
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
  await d1.execute("DELETE FROM usage_records WHERE user_id = ?", [
    TEST_USER_ID,
  ]);
  await d1.execute("DELETE FROM accounts WHERE user_id = ?", [TEST_USER_ID]);
  await d1.execute("DELETE FROM users WHERE id = ?", [TEST_USER_ID]);
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
