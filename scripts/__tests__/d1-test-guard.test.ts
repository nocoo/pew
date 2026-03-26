import { describe, it, expect, vi, beforeEach } from "vitest";
import { validateAndOverride, verifyTestMarker } from "../d1-test-guard";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROD_ENV = {
  CF_ACCOUNT_ID: "acc-prod-123",
  CF_D1_DATABASE_ID: "prod-db-id-aaaa",
  CF_D1_API_TOKEN: "tok-prod-xxx",
  WORKER_INGEST_URL: "https://pew-ingest.worker.example.com/ingest",
  WORKER_READ_URL: "https://pew.worker.example.com",
  WORKER_SECRET: "shared-secret",
  WORKER_READ_SECRET: "shared-read-secret",
};

const TEST_ENV = {
  CF_D1_DATABASE_ID_TEST: "test-db-id-bbbb",
  WORKER_INGEST_URL_TEST: "https://pew-ingest-test.worker.example.com/ingest",
  WORKER_READ_URL_TEST: "https://pew-test.worker.example.com",
};

// ---------------------------------------------------------------------------
// Mock global fetch for marker verification
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

/** Helper: mock a successful _test_marker response. */
function mockMarkerSuccess() {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      result: [{ results: [{ value: "test" }] }],
    }),
  } as Response);
}

// ---------------------------------------------------------------------------
// Layer 1: Existence checks
// ---------------------------------------------------------------------------

describe("Layer 1: existence checks", () => {
  it("should throw when CF_D1_DATABASE_ID_TEST is missing", async () => {
    const envTest = { ...TEST_ENV };
    delete (envTest as Record<string, string>).CF_D1_DATABASE_ID_TEST;

    await expect(validateAndOverride(PROD_ENV, envTest)).rejects.toThrow(
      "CF_D1_DATABASE_ID_TEST not set",
    );
  });

  it("should throw when WORKER_INGEST_URL_TEST is missing", async () => {
    const envTest = { ...TEST_ENV };
    delete (envTest as Record<string, string>).WORKER_INGEST_URL_TEST;

    await expect(validateAndOverride(PROD_ENV, envTest)).rejects.toThrow(
      "WORKER_INGEST_URL_TEST not set",
    );
  });

  it("should throw when WORKER_READ_URL_TEST is missing", async () => {
    const envTest = { ...TEST_ENV };
    delete (envTest as Record<string, string>).WORKER_READ_URL_TEST;

    await expect(validateAndOverride(PROD_ENV, envTest)).rejects.toThrow(
      "WORKER_READ_URL_TEST not set",
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 2: DB non-equality
// ---------------------------------------------------------------------------

describe("Layer 2: DB non-equality", () => {
  it("should throw when test DB ID === prod DB ID", async () => {
    const envTest = {
      ...TEST_ENV,
      CF_D1_DATABASE_ID_TEST: PROD_ENV.CF_D1_DATABASE_ID,
    };

    await expect(validateAndOverride(PROD_ENV, envTest)).rejects.toThrow(
      "test DB ID === prod DB ID",
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 3: Worker URL non-equality
// ---------------------------------------------------------------------------

describe("Layer 3: Worker URL non-equality", () => {
  it("should throw when test ingest URL === prod ingest URL", async () => {
    const envTest = {
      ...TEST_ENV,
      WORKER_INGEST_URL_TEST: PROD_ENV.WORKER_INGEST_URL,
    };

    await expect(validateAndOverride(PROD_ENV, envTest)).rejects.toThrow(
      "test WORKER_INGEST_URL === prod WORKER_INGEST_URL",
    );
  });

  it("should throw when test read URL === prod read URL", async () => {
    const envTest = {
      ...TEST_ENV,
      WORKER_READ_URL_TEST: PROD_ENV.WORKER_READ_URL,
    };

    await expect(validateAndOverride(PROD_ENV, envTest)).rejects.toThrow(
      "test WORKER_READ_URL === prod WORKER_READ_URL",
    );
  });
});

// ---------------------------------------------------------------------------
// Layer 4: Marker verification
// ---------------------------------------------------------------------------

describe("Layer 4: _test_marker verification", () => {
  it("should throw when D1 API returns non-ok response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false }),
    } as Response);

    await expect(
      verifyTestMarker("acc-id", "db-id", "token"),
    ).rejects.toThrow("D1 API returned HTTP 500");
  });

  it("should throw when _test_marker value is not 'test'", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: [{ results: [{ value: "production" }] }],
      }),
    } as Response);

    await expect(
      verifyTestMarker("acc-id", "db-id", "token"),
    ).rejects.toThrow('_test_marker.value = "production"');
  });

  it("should throw when _test_marker table is empty", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: [{ results: [] }],
      }),
    } as Response);

    await expect(
      verifyTestMarker("acc-id", "db-id", "token"),
    ).rejects.toThrow("expected \"test\"");
  });

  it("should throw when fetch fails (network error)", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      verifyTestMarker("acc-id", "db-id", "token"),
    ).rejects.toThrow("cannot reach D1 API");
  });

  it("should pass when marker value is 'test'", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        result: [{ results: [{ value: "test" }] }],
      }),
    } as Response);

    await expect(
      verifyTestMarker("acc-id", "db-id", "token"),
    ).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Happy path: full validation
// ---------------------------------------------------------------------------

describe("validateAndOverride happy path", () => {
  it("should return overridden env with test resources", async () => {
    mockMarkerSuccess();

    const result = await validateAndOverride(PROD_ENV, TEST_ENV);

    // Overridden keys
    expect(result.CF_D1_DATABASE_ID).toBe(TEST_ENV.CF_D1_DATABASE_ID_TEST);
    expect(result.WORKER_INGEST_URL).toBe(TEST_ENV.WORKER_INGEST_URL_TEST);
    expect(result.WORKER_READ_URL).toBe(TEST_ENV.WORKER_READ_URL_TEST);

    // Preserved keys
    expect(result.CF_ACCOUNT_ID).toBe(PROD_ENV.CF_ACCOUNT_ID);
    expect(result.CF_D1_API_TOKEN).toBe(PROD_ENV.CF_D1_API_TOKEN);
    expect(result.WORKER_SECRET).toBe(PROD_ENV.WORKER_SECRET);
    expect(result.WORKER_READ_SECRET).toBe(PROD_ENV.WORKER_READ_SECRET);
  });

  it("should call D1 API with correct URL and auth header", async () => {
    mockMarkerSuccess();

    await validateAndOverride(PROD_ENV, TEST_ENV);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(PROD_ENV.CF_ACCOUNT_ID);
    expect(url).toContain(TEST_ENV.CF_D1_DATABASE_ID_TEST);
    expect((opts.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${PROD_ENV.CF_D1_API_TOKEN}`,
    );
  });

  it("should throw when CF_ACCOUNT_ID is missing", async () => {
    const envLocal = { ...PROD_ENV };
    delete (envLocal as Record<string, string>).CF_ACCOUNT_ID;

    await expect(validateAndOverride(envLocal, TEST_ENV)).rejects.toThrow(
      "CF_ACCOUNT_ID or CF_D1_API_TOKEN not set",
    );
  });
});
