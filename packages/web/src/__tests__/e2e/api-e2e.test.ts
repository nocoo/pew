/**
 * L2 API E2E tests against Next.js and per-run local D1/Workers.
 *
 * The server runs with E2E_SKIP_AUTH=true, so all requests are authenticated
 * as E2E_TEST_USER_ID without needing OAuth.
 *
 * Run `bun run test:e2e` from an environment-file-free task clone. The runner
 * owns the schema, synthetic credentials, processes and temporary storage.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import type { ByDeviceResponse } from "@pew/core";
import { D1Client } from "../../lib/d1";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const E2E_PORT = process.env.E2E_PORT || "17020";
const BASE_URL = `http://localhost:${E2E_PORT}`;

// Per-run identity supplied by the isolated runner.
const TEST_USER_ID = process.env.E2E_TEST_USER_ID || "e2e-test-user-id";
const TEST_USER_EMAIL = process.env.E2E_TEST_USER_EMAIL || "e2e@test.local";
// Stable slug derived from user id so concurrent CI runs don't collide
const RUN_SUFFIX = TEST_USER_ID.replace("e2e-test-user-", "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "local";
const TEST_USER_SLUG = `e2e-user-${RUN_SUFFIX}`;

/** Headers for ingest requests — includes version gate header */
const INGEST_HEADERS = {
  "Content-Type": "application/json",
  "X-Pew-Client-Version": "3.0.0",
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

async function logUnexpectedStatus(response: Response, expected: number): Promise<void> {
  if (response.status === expected) return;
  console.error("Unexpected API response", {
    url: response.url,
    status: response.status,
    contentType: response.headers.get("content-type"),
    body: (await response.clone().text()).slice(0, 4096),
  });
}

async function seedTestUser(d1: D1Client): Promise<void> {
  await d1.execute(
    `INSERT INTO users (id, email, name, slug, is_public, created_at, updated_at)
     VALUES (?, ?, ?, ?, 1, datetime('now'), datetime('now'))
     ON CONFLICT (id) DO UPDATE SET
       email = excluded.email,
       slug = excluded.slug,
       is_public = 1`,
    [TEST_USER_ID, TEST_USER_EMAIL, "E2E Test User", TEST_USER_SLUG],
  );
}

async function cleanupTestData(d1: D1Client): Promise<void> {
  // Delete non-cascading fixture children before their user.
  const tables = [
    { sql: "DELETE FROM season_team_members WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM device_aliases WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM session_records WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM usage_records WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM accounts WHERE user_id = ?", params: [TEST_USER_ID] },
    { sql: "DELETE FROM users WHERE id = ?", params: [TEST_USER_ID] },
  ];

  for (const { sql, params } of tables) {
    await d1.execute(sql, params);
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
  it("blocks 2.x clients and explains the supported version and upgrade commands", async () => {
    const res = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: { ...INGEST_HEADERS, "X-Pew-Client-Version": "2.29.2" },
      body: JSON.stringify([makeRecord()]),
    });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("2.29.2");
    expect(error).toContain("3.0.0");
    expect(error).toContain("npm install -g @nocoo/pew@latest");
    expect(error).toContain("bun add -g @nocoo/pew@latest");
    expect(error).not.toContain("pew reset");
  });

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
        source: "pi",
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

  it("accepts and reads back grok source records — every whitelist entry point", async () => {
    // 1. POST /api/ingest — bare-array body with grok source
    const ingest = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify([
        makeRecord({
          source: "grok",
          model: "grok-4.5",
          hour_start: "2026-03-15T10:00:00.000Z",
          // Disjoint: output = completion - reasoning (1682 - 111)
          input_tokens: 25315,
          cached_input_tokens: 63872,
          output_tokens: 1571,
          reasoning_output_tokens: 111,
          total_tokens: 90869,
          device_id: "e2e-grok-device",
        }),
      ]),
    });
    expect(ingest.status).toBe(200);

    // 2. Every ?source= route whitelist entry
    for (const path of [
      "/api/usage?source=grok&from=2026-03-01&to=2026-03-31",
      "/api/sessions?source=grok",
      "/api/leaderboard?source=grok&from=2026-03-01&to=2026-03-31",
      `/api/users/${TEST_USER_SLUG}?source=grok&from=2026-03-01&to=2026-03-31`,
    ]) {
      const r = await fetch(`${BASE_URL}${path}`);
      expect(r.status, path).toBe(200);
    }

    // Token retention on user route
    const userRes = await fetch(
      `${BASE_URL}/api/users/${TEST_USER_SLUG}?source=grok&from=2026-03-01&to=2026-03-31`,
    );
    expect(userRes.status).toBe(200);
    const userBody = await userRes.json();
    expect(userBody.summary.reasoning_output_tokens).toBe(111);
  });

  it("ignores new zcode reports while keeping historical tokens readable", async () => {
    await d1.execute(`INSERT INTO usage_records
      (user_id,device_id,source,model,hour_start,input_tokens,cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens)
      VALUES (?, 'e2e-zcode-device','zcode','GLM-5.2','2026-07-10T01:00:00.000Z',11242,52992,1329,0,65563)`, [TEST_USER_ID]);
    const ingest = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify([
        makeRecord({
          source: "zcode",
          model: "GLM-5.2",
          hour_start: "2026-07-10T01:00:00.000Z",
          // Local-machine 4-row aggregate (docs/43-zcode-support.md §1.4).
          input_tokens: 11242,
          cached_input_tokens: 52992,
          output_tokens: 1329,
          reasoning_output_tokens: 0,
          total_tokens: 65563,
          device_id: "e2e-zcode-device",
        }),
      ]),
    });
    expect(ingest.status).toBe(200);
    expect(await ingest.json()).toMatchObject({ ingested: 0, ignored: 1 });

    // 2. Every ?source= query allowlist route
    for (const path of [
      "/api/usage?source=zcode&from=2026-07-01&to=2026-07-31",
      "/api/sessions?source=zcode",
      "/api/leaderboard?source=zcode&from=2026-07-01&to=2026-07-31",
      `/api/users/${TEST_USER_SLUG}?source=zcode&from=2026-07-01&to=2026-07-31`,
    ]) {
      const r = await fetch(`${BASE_URL}${path}`);
      expect(r.status, path).toBe(200);
    }

    // Token retention on user route
    const userRes = await fetch(
      `${BASE_URL}/api/users/${TEST_USER_SLUG}?source=zcode&from=2026-07-01&to=2026-07-31`,
    );
    expect(userRes.status).toBe(200);
    const userBody = await userRes.json();
    expect(userBody.summary.cached_input_tokens).toBe(52992);
  });

  it("retired token/session reports cannot replace history or block active mixed batches", async () => {
    const sources = ["gemini-cli", "kosmos", "omp", "pmstudio", "vscode-copilot", "zcode"];
    const historicalTime = "2024-10-01T01:00:00.000Z";
    try {
      for (const source of sources) {
        await d1.execute(`INSERT INTO usage_records
          (user_id,device_id,source,model,hour_start,input_tokens,total_tokens)
          VALUES (?, 'retirement-fixture', ?, 'historical-model', ?, 123, 123)`, [TEST_USER_ID, source, historicalTime]);
        await d1.execute(`INSERT INTO session_records
          (user_id,session_key,source,started_at,last_message_at,duration_seconds,user_messages,assistant_messages,total_messages,model,snapshot_at)
          VALUES (?, ?, ?, ?, ?, 0, 1, 1, 2, 'historical-model', ?)`,
          [TEST_USER_ID, `retired:${source}`, source, historicalTime, historicalTime, historicalTime]);
        const token = await fetch(`${BASE_URL}/api/ingest`, { method: "POST", headers: INGEST_HEADERS,
          body: JSON.stringify([makeRecord({ source, device_id: "retirement-fixture", model: "historical-model",
            hour_start: historicalTime, total_tokens: "unsafe", prompt: "PRIVATE_SYNTHETIC_BODY" })]) });
        expect(token.status).toBe(200);
        expect(await token.json()).toMatchObject({ ingested: 0, ignored: 1 });
        const session = await fetch(`${BASE_URL}/api/ingest/sessions`, { method: "POST", headers: INGEST_HEADERS,
          body: JSON.stringify([{ source, session_key: `retired:${source}`, total_messages: -1 }]) });
        expect(session.status).toBe(200);
        expect(await session.json()).toMatchObject({ ingested: 0, ignored: 1 });
        const query = `source=${source}&from=2024-10-01&to=2024-10-02`;
        for (const path of ["/api/usage", `/api/users/${TEST_USER_SLUG}`]) {
          const response = await fetch(`${BASE_URL}${path}?${query}`);
          expect(response.status).toBe(200);
          expect((await response.json()).summary.total_tokens).toBe(123);
        }
        const stored = await d1.firstOrNull<{ total_messages: number }>(
          "SELECT total_messages FROM session_records WHERE user_id=? AND session_key=?", [TEST_USER_ID, `retired:${source}`]);
        expect(stored?.total_messages).toBe(2);
        const ranked = await fetch(`${BASE_URL}/api/leaderboard?period=all&source=${source}`);
        expect(ranked.status).toBe(200);
        expect((await ranked.json()).entries.some((entry: { user: { id: string }; total_tokens: number }) =>
          entry.user.id === TEST_USER_ID && entry.total_tokens >= 123)).toBe(true);
      }
      const active = makeRecord({ source: "pi", device_id: "retirement-fixture", model: "active-model", hour_start: historicalTime });
      const mixed = await fetch(`${BASE_URL}/api/ingest`, { method: "POST", headers: INGEST_HEADERS,
        body: JSON.stringify([...sources.map((source) => ({ source, private_body: "IGNORE" })), active]) });
      expect(mixed.status).toBe(200);
      expect(await mixed.json()).toMatchObject({ ingested: 1, ignored: 6 });
    } finally {
      await d1.execute("DELETE FROM usage_records WHERE user_id=? AND device_id='retirement-fixture'", [TEST_USER_ID]);
      await d1.execute("DELETE FROM session_records WHERE user_id=? AND session_key LIKE 'retired:%'", [TEST_USER_ID]);
    }
  });

  it("round-trips Antigravity disjoint counters and deduplicates uploads", async () => {
    const record = makeRecord({ source: "antigravity", model: "gemini-3.8-flash-n",
      hour_start: "2026-10-01T01:00:00.000Z", device_id: "e2e-antigravity-device",
      input_tokens: 100, cached_input_tokens: 900, output_tokens: 40, reasoning_output_tokens: 60, total_tokens: 1100 });
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${BASE_URL}/api/ingest`, {
        method: "POST", headers: INGEST_HEADERS, body: JSON.stringify([record]),
      });
      expect(res.status).toBe(200);
    }
    const query = "source=antigravity&from=2026-10-01&to=2026-10-02";
    for (const path of ["/api/usage", "/api/sessions", "/api/leaderboard", `/api/users/${TEST_USER_SLUG}`]) {
      expect((await fetch(`${BASE_URL}${path}?${query}`)).status, path).toBe(200);
    }
    const res = await fetch(`${BASE_URL}/api/usage?${query}`);
    const body = await res.json();
    expect(body.summary).toMatchObject({ input_tokens: 100, cached_input_tokens: 900,
      output_tokens: 40, reasoning_output_tokens: 60, total_tokens: 1100 });
    expect(body.records).toHaveLength(1);
    const summary = body.summary;
    expect(summary.cached_input_tokens / (summary.input_tokens + summary.cached_input_tokens)).toBe(0.9);
  });

  it("accepts and reads back workbuddy source records — every whitelist entry point", async () => {
    // 1. POST /api/ingest — bare-array body with workbuddy source. It carries a
    //    device_id, so the by-device breakdown test includes it as a 4th device.
    const ingest = await fetch(`${BASE_URL}/api/ingest`, {
      method: "POST",
      headers: INGEST_HEADERS,
      body: JSON.stringify([
        makeRecord({
          source: "workbuddy",
          model: "hy4-preview",
          hour_start: "2026-07-10T01:00:00.000Z",
          // Local-machine aggregate: prompt 1000 (400 cached) + completion 200.
          input_tokens: 600,
          cached_input_tokens: 400,
          output_tokens: 150,
          reasoning_output_tokens: 50,
          total_tokens: 1200,
          device_id: "e2e-workbuddy-device",
        }),
      ]),
    });
    expect(ingest.status).toBe(200);

    // 2. Every ?source= query allowlist route
    for (const path of [
      "/api/usage?source=workbuddy&from=2026-07-01&to=2026-07-31",
      "/api/sessions?source=workbuddy",
      "/api/leaderboard?source=workbuddy&from=2026-07-01&to=2026-07-31",
      `/api/users/${TEST_USER_SLUG}?source=workbuddy&from=2026-07-01&to=2026-07-31`,
    ]) {
      const r = await fetch(`${BASE_URL}${path}`);
      expect(r.status, path).toBe(200);
    }

    // Token retention on user route
    const userRes = await fetch(
      `${BASE_URL}/api/users/${TEST_USER_SLUG}?source=workbuddy&from=2026-07-01&to=2026-07-31`,
    );
    expect(userRes.status).toBe(200);
    const userBody = await userRes.json();
    expect(userBody.summary.cached_input_tokens).toBe(400);
  });
});

describe("CLI upgrade notice persistence", () => {
  it("shows once per account and preserves that decision in D1", async () => {
    const first = await fetch(`${BASE_URL}/api/cli-upgrade-notice`, { method: "POST" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ show: true });
    const second = await fetch(`${BASE_URL}/api/cli-upgrade-notice`, { method: "POST" });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ show: false });
    const row = await d1.firstOrNull<{ cli_upgrade_notice_seen_at: string }>(
      "SELECT cli_upgrade_notice_seen_at FROM users WHERE id = ?", [TEST_USER_ID],
    );
    expect(row?.cli_upgrade_notice_seen_at).toBeTruthy();
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

    // We have 3 distinct records: claude-code, pi, opencode
    expect(body.records.length).toBe(3);
    expect(body.summary).toBeDefined();
    // Total = 1700 (claude overwritten) + 850 (pi) + 1300 (opencode) = 3850
    expect(body.summary.total_tokens).toBe(3850);
  });

  it("should filter by source", async () => {
    const res = await fetch(
      `${BASE_URL}/api/usage?from=2026-03-01&to=2026-03-02&source=pi`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.records.length).toBe(1);
    expect(body.records[0].source).toBe("pi");
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

  it.each([
    ["source=invalid", "Invalid source parameter"],
    ["granularity=weekly", "Invalid granularity parameter"],
  ])("rejects invalid usage parameter %s", async (query, error) => {
    const res = await fetch(`${BASE_URL}/api/usage?${query}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
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

  it("reuses ranked snapshots and revokes them immediately after privacy changes", async () => {
    const settings = async (is_public: boolean) => fetch(`${BASE_URL}/api/settings`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ is_public }),
    });
    expect((await settings(true)).status).toBe(200);
    try {
      const first = await (await fetch(`${BASE_URL}/api/leaderboard?period=all&limit=100`)).json();
      expect(first.entries.some((entry: { user: { id: string } }) => entry.user.id === TEST_USER_ID)).toBe(true);
      expect(first.snapshotId).toMatch(/^[a-f0-9]{64}$/);
      const warm = await (await fetch(`${BASE_URL}/api/leaderboard?period=all&limit=1`)).json();
      expect(warm.snapshotId).toBe(first.snapshotId);
      expect(warm.expiresAt).toBe(first.expiresAt);
      expect((await settings(false)).status).toBe(200);
      const stale = await fetch(`${BASE_URL}/api/leaderboard?period=all&offset=1&snapshot=${first.snapshotId}`);
      expect(stale.status).toBe(409);
      expect((await stale.json()).code).toBe("LEADERBOARD_CHANGED");
      const fresh = await fetch(`${BASE_URL}/api/leaderboard?period=all&limit=100`);
      expect(fresh.status).toBe(200);
      expect(fresh.headers.get("Cache-Control")).toBe("private, no-store");
      expect((await fresh.json()).entries.some((entry: { user: { id: string } }) => entry.user.id === TEST_USER_ID)).toBe(false);
    } finally { expect((await settings(true)).status).toBe(200); }
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
// GET /api/usage/by-device
// ===========================================================================

describe("GET /api/usage/by-device", () => {
  it("returns all five ingested devices with consistent named counts across every breakdown", async () => {
    const res = await fetch(`${BASE_URL}/api/usage/by-device?from=2020-01-01`);
    expect(res.status).toBe(200);
    const body: ByDeviceResponse = await res.json();
    const expected = [
      { device_id: "default", date: "2026-03-01", input_tokens: 2300, cached_input_tokens: 300,
        output_tokens: 1100, reasoning_output_tokens: 150, total_tokens: 3850 },
      { device_id: "e2e-grok-device", date: "2026-03-15", input_tokens: 25315, cached_input_tokens: 63872,
        output_tokens: 1571, reasoning_output_tokens: 111, total_tokens: 90869 },
      { device_id: "e2e-zcode-device", date: "2026-07-10", input_tokens: 11242, cached_input_tokens: 52992,
        output_tokens: 1329, reasoning_output_tokens: 0, total_tokens: 65563 },
      { device_id: "e2e-antigravity-device", date: "2026-10-01", input_tokens: 100, cached_input_tokens: 900,
        output_tokens: 40, reasoning_output_tokens: 60, total_tokens: 1100 },
      { device_id: "e2e-workbuddy-device", date: "2026-07-10", input_tokens: 600, cached_input_tokens: 400,
        output_tokens: 150, reasoning_output_tokens: 50, total_tokens: 1200 },
    ];
    expect(body.devices).toHaveLength(5);
    expect(body.timeline).toHaveLength(5);
    expect(body.deviceDetails).toHaveLength(7);
    for (const { date, ...device } of expected) {
      expect(body.devices.find((row) => row.device_id === device.device_id)).toMatchObject(device);
      expect(body.timeline.find((row) => row.device_id === device.device_id)).toMatchObject({ ...device, date });
      expect(body.deviceDetails.filter((row) => row.device_id === device.device_id))
        .toHaveLength(device.device_id === "default" ? 3 : 1);
    }

    const usage = await fetch(`${BASE_URL}/api/usage?from=2020-01-01`);
    expect(usage.status).toBe(200);
    const { summary } = await usage.json();
    for (const field of ["input_tokens", "cached_input_tokens", "output_tokens", "reasoning_output_tokens", "total_tokens"] as const) {
      expect(summary[field]).toBe(expected.reduce((sum, row) => sum + row[field], 0));
      for (const rows of [body.devices, body.timeline, body.deviceDetails]) {
        expect(rows.reduce((sum, row) => sum + row[field], 0), field).toBe(summary[field]);
        for (const device of expected) {
          expect(rows.filter((row) => row.device_id === device.device_id)
            .reduce((sum, row) => sum + row[field], 0), `${device.device_id}.${field}`).toBe(device[field]);
        }
      }
    }
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

describe("organization lists", () => {
  it.each(["/api/organizations", "/api/organizations/mine"])("returns an empty list from %s", async (path) => {
    const res = await fetch(`${BASE_URL}${path}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ organizations: [] });
  });
});

// ===========================================================================
// POST /api/ingest/sessions
// ===========================================================================

describe("POST /api/ingest/sessions", () => {
  it.each(["grok", "antigravity"])("ingests and reads %s sessions after project tables are retired", async (source) => {
    const record = {
      session_key: `${source}:e2e-${RUN_SUFFIX}`,
      source,
      kind: "human",
      started_at: "2026-09-13T10:00:00.000Z",
      last_message_at: "2026-09-13T10:10:00.000Z",
      duration_seconds: 600,
      user_messages: 2,
      assistant_messages: 3,
      total_messages: 5,
      project_ref: "0123456789abcdef",
      model: "test-model",
      snapshot_at: "2026-09-13T10:10:00.000Z",
    };
    for (let replay = 0; replay < 2; replay++) {
      const response = await fetch(`${BASE_URL}/api/ingest/sessions`, {
        method: "POST",
        headers: INGEST_HEADERS,
        body: JSON.stringify([record]),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).ingested).toBe(1);
    }

    const response = await fetch(`${BASE_URL}/api/sessions?source=${source}&kind=human&from=2026-09-13&to=2026-09-13`);
    expect(response.status).toBe(200);
    const { snapshot_at: _snapshot, ...expected } = record;
    expect(await response.json()).toEqual({
      records: [expected],
      summary: {
        total_sessions: 1,
        total_duration_seconds: 600,
        total_user_messages: 2,
        total_assistant_messages: 3,
        total_messages: 5,
      },
    });
  });

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
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ valid: false, error: "Invalid invite code format" });
  });
});

describe("POST /api/auth/code", () => {
  it("should generate and persist an expiring auth code", async () => {
    const started = Date.now();
    const res = await fetch(`${BASE_URL}/api/auth/code`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(new Date(body.expires_at).getTime()).toBeGreaterThan(started);
    const row = await d1.firstOrNull(
      "SELECT user_id, expires_at, used_at, failed_attempts FROM auth_codes WHERE code = ?", [body.code],
    );
    expect(row).toEqual({ user_id: TEST_USER_ID, expires_at: body.expires_at, used_at: null, failed_attempts: 0 });
  });
});

describe("POST /api/auth/code/verify", () => {
  it("should reject invalid code", async () => {
    const res = await fetch(`${BASE_URL}/api/auth/code/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "XXXX-YYYY" }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid or expired code" });
  });
});

// ===========================================================================
// Teams routes
// ===========================================================================

describe("GET /api/teams/[teamId]", () => {
  it("should return 403 for a non-member without revealing team existence", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/non-existent-team-id`);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Not a member" });
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
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid invite code format" });
  });
});

// ===========================================================================
// Organizations member routes
// ===========================================================================

describe("missing organization", () => {
  it.each([
    ["GET", "members"],
    ["POST", "join"],
    ["DELETE", "leave"],
  ])("returns 404 for %s /api/organizations/[orgId]/%s", async (method, action) => {
    const res = await fetch(`${BASE_URL}/api/organizations/non-existent-org/${action}`, {
      method,
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Organization not found" });
  });
});

// ===========================================================================
// Season routes
// ===========================================================================

describe("GET /api/seasons/[seasonId]/leaderboard", () => {
  it("should return 404 for non-existent season", async () => {
    const res = await fetch(`${BASE_URL}/api/seasons/non-existent-season/leaderboard`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Season not found" });
  });
});

describe("POST /api/seasons/[seasonId]/register", () => {
  it("should return 404 for non-existent season", async () => {
    const res = await fetch(`${BASE_URL}/api/seasons/non-existent-season/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ team_id: "t1" }),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Season not found" });
  });
});

// ===========================================================================
// Admin routes (require admin auth)
// ===========================================================================

// Admin routes require special admin user setup.
// These tests verify the routes reject non-admin users with 403.

describe("GET /api/admin/check", () => {
  it("should check admin status", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/check`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.isAdmin).toBe("boolean");
  });
});

describe("GET /api/admin/settings", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/settings`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/users", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/users`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/invites", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/invites`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/seasons", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/seasons`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/organizations", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/storage", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/storage`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/cache", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/cache`);
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/usage/compare", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/usage/compare`);
    expect(res.status).toBe(403);
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
// Admin organization management routes
// ===========================================================================

describe("GET /api/admin/organizations/[orgId]", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent`);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/admin/organizations/[orgId]", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/organizations/[orgId]", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/organizations/[orgId]/logo", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/logo`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/organizations/[orgId]/logo", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/logo`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/admin/organizations/[orgId]/members", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/members`);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/organizations/[orgId]/members", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/admin/organizations/[orgId]/members/[userId]", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/organizations/non-existent/members/non-existent`, {
      method: "DELETE",
    });
    await logUnexpectedStatus(res, 403);
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// Admin season management routes
// ===========================================================================

describe("PATCH /api/admin/seasons/[seasonId]", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/seasons/non-existent`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Test Season" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/seasons/[seasonId]/snapshot", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/seasons/non-existent/snapshot`, {
      method: "POST",
    });
    await logUnexpectedStatus(res, 403);
    expect(res.status).toBe(403);
  });
});

describe("POST /api/admin/seasons/[seasonId]/sync-rosters", () => {
  it("should return 403 for non-admin", async () => {
    const res = await fetch(`${BASE_URL}/api/admin/seasons/non-existent/sync-rosters`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// Team member management routes
// ===========================================================================

describe("POST /api/teams/[teamId]/logo", () => {
  it("should return 403 for non-member", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/non-existent/logo`, {
      method: "POST",
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/teams/[teamId]/logo", () => {
  it("should return 403 for non-member", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/non-existent/logo`, {
      method: "DELETE",
    });
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/teams/[teamId]/members/[userId]", () => {
  it("should return 403 for non-member", async () => {
    const res = await fetch(`${BASE_URL}/api/teams/non-existent/members/non-existent`, {
      method: "DELETE",
    });
    await logUnexpectedStatus(res, 403);
    expect(res.status).toBe(403);
  });
})

// Removed endpoints must not expose feature data or accept new submissions.
describe("retired feature endpoints", () => {
  it.each([
    "/api/showcases",
    "/api/showcases/preview",
    "/api/showcases/retired",
    "/api/showcases/retired/upvote",
    "/api/showcases/retired/refresh",
    "/api/admin/showcases",
    "/api/achievements",
    "/api/achievements/retired/members",
    "/api/users/retired/achievements",
    "/api/projects",
    "/api/projects/retired",
    "/api/projects/timeline?from=2026-01-01&to=2026-12-31",
  ])("returns 404 for %s", async (path) => {
    const response = await fetch(`${BASE_URL}${path}`);
    expect(response.status).toBe(404);
  });

  it("rejects showcase submissions", async () => {
    const response = await fetch(`${BASE_URL}/api/showcases`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ github_url: "https://github.com/nocoo/pew" }),
    });
    expect(response.status).toBe(404);
  });

  it("rejects project creation", async () => {
    const response = await fetch(`${BASE_URL}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Retired project" }),
    });
    expect(response.status).toBe(404);
  });
});
