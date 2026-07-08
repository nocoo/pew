#!/usr/bin/env bun
/**
 * D1 Test Isolation Guards
 *
 * Four-layer defense ensuring E2E tests never touch production D1:
 * 1. Existence check: test env vars must be set
 * 2. DB non-equality check: test DB ID ≠ prod DB ID
 * 3. Worker non-equality check: test Worker URLs ≠ prod Worker URLs
 * 4. Marker check: test DB must contain _test_marker table with env='test'
 *
 * @see docs/31-d1-test-isolation.md
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// TestGuardResult interface removed 2026-07-08 (G1 cleanup): no consumers.
// The function returns an inline object literal; restore an explicit shape
// here if it ever needs to be shared.

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * Validate test isolation and return overridden env vars.
 *
 * Takes prod env (from .env.local) and test env (from .env.test).
 * Returns a merged env dict where CF_D1_DATABASE_ID, WORKER_INGEST_URL,
 * and WORKER_READ_URL point to test resources.
 *
 * Throws on any validation failure (hard gate).
 */
export async function validateAndOverride(
  envLocal: Record<string, string>,
  envTest: Record<string, string>,
): Promise<Record<string, string>> {
  const errors: string[] = [];

  // --- Layer 1: Existence ---
  const testDbId = envTest.CF_D1_DATABASE_ID_TEST;
  const prodDbId = envLocal.CF_D1_DATABASE_ID;
  const testIngestUrl = envTest.WORKER_INGEST_URL_TEST;
  const testReadUrl = envTest.WORKER_READ_URL_TEST;

  if (!testDbId) errors.push("CF_D1_DATABASE_ID_TEST not set in .env.test");
  if (!testIngestUrl)
    errors.push("WORKER_INGEST_URL_TEST not set in .env.test");
  if (!testReadUrl) errors.push("WORKER_READ_URL_TEST not set in .env.test");

  // --- Layer 2: DB non-equality ---
  if (testDbId && prodDbId && testDbId === prodDbId) {
    errors.push(
      `FATAL: test DB ID === prod DB ID (${testDbId}). ` +
        "Refusing to run E2E tests against production database.",
    );
  }

  // --- Layer 3: Worker URL non-equality ---
  const prodIngestUrl = envLocal.WORKER_INGEST_URL;
  const prodReadUrl = envLocal.WORKER_READ_URL;

  if (testIngestUrl && prodIngestUrl && testIngestUrl === prodIngestUrl) {
    errors.push(
      `FATAL: test WORKER_INGEST_URL === prod WORKER_INGEST_URL (${testIngestUrl}). ` +
        "Test writes would hit production.",
    );
  }
  if (testReadUrl && prodReadUrl && testReadUrl === prodReadUrl) {
    errors.push(
      `FATAL: test WORKER_READ_URL === prod WORKER_READ_URL (${testReadUrl}). ` +
        "Test reads would hit production.",
    );
  }

  // Bail early if any of the first 3 layers failed
  if (errors.length > 0) {
    throw new Error(
      `🚫 D1 Test Isolation FAILED:\n  ${errors.join("\n  ")}`,
    );
  }

  // --- Layer 4: Marker check ---
  const accountId = envLocal.CF_ACCOUNT_ID;
  const apiToken = envLocal.CF_D1_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error(
      "🚫 D1 Test Isolation FAILED: CF_ACCOUNT_ID or CF_D1_API_TOKEN not set in .env.local. " +
        "Cannot verify _test_marker in test DB.",
    );
  }

  await verifyTestMarker(accountId, testDbId, apiToken);

  // --- Build overridden env ---
  return {
    ...envLocal,
    CF_D1_DATABASE_ID: testDbId, // Override prod → test
    WORKER_INGEST_URL: testIngestUrl, // Override prod → test
    WORKER_READ_URL: testReadUrl, // Override prod → test
  };
}

// ---------------------------------------------------------------------------
// Marker verification via D1 REST API
// ---------------------------------------------------------------------------

/**
 * Verify the test DB contains a _test_marker table with env='test'.
 * Uses the Cloudflare D1 REST API directly (no Workers involved).
 */
export async function verifyTestMarker(
  accountId: string,
  databaseId: string,
  apiToken: string,
): Promise<void> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sql: "SELECT value FROM _test_marker WHERE key = 'env'",
      }),
    });
  } catch (err) {
    throw new Error(
      `🚫 D1 Test Isolation FAILED: cannot reach D1 API to verify _test_marker: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }

  if (!response.ok) {
    throw new Error(
      `🚫 D1 Test Isolation FAILED: D1 API returned HTTP ${response.status} ` +
        `when verifying _test_marker in database ${databaseId}`,
    );
  }

  const data = (await response.json()) as {
    success: boolean;
    result?: Array<{ results?: Array<{ value: string }> }>;
  };

  if (!data.success) {
    throw new Error(
      "🚫 D1 Test Isolation FAILED: D1 API query unsuccessful. " +
        "Is the _test_marker table created in the test DB?",
    );
  }

  const value = data.result?.[0]?.results?.[0]?.value;
  if (value !== "test") {
    throw new Error(
      `🚫 D1 Test Isolation FAILED: _test_marker.value = ${JSON.stringify(value)}, expected "test". ` +
        "This database may not be the test environment.",
    );
  }
}
