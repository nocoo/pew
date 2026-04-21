import { describe, it, expect, vi, beforeEach } from "vitest";
import { D1Client, D1Error, getD1Client, resetD1Client } from "../lib/d1";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const TEST_CONFIG = {
  accountId: "test-account-id",
  databaseId: "test-database-id",
  apiToken: "test-api-token",
};

function mockD1Response(results: unknown[], success = true) {
  return {
    ok: success,
    status: success ? 200 : 500,
    json: () =>
      Promise.resolve({
        success,
        result: [{ results, meta: { changes: 0, duration: 0.1 } }],
        errors: success ? [] : [{ message: "D1 error" }],
      }),
  };
}

describe("D1Client", () => {
  let client: D1Client;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new D1Client(TEST_CONFIG);
  });

  describe("constructor", () => {
    it("should store config", () => {
      const c = new D1Client(TEST_CONFIG);
      expect(c).toBeDefined();
    });

    it("should throw if accountId is empty", () => {
      expect(
        () => new D1Client({ ...TEST_CONFIG, accountId: "" })
      ).toThrow("accountId is required");
    });

    it("should throw if databaseId is empty", () => {
      expect(
        () => new D1Client({ ...TEST_CONFIG, databaseId: "" })
      ).toThrow("databaseId is required");
    });

    it("should throw if apiToken is empty", () => {
      expect(
        () => new D1Client({ ...TEST_CONFIG, apiToken: "" })
      ).toThrow("apiToken is required");
    });
  });

  describe("query()", () => {
    it("should send correct HTTP request", async () => {
      mockFetch.mockResolvedValueOnce(
        mockD1Response([{ id: 1, name: "test" }])
      );

      await client.query("SELECT * FROM users WHERE id = ?", [1]);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0]!;
      expect(url).toBe(
        "https://api.cloudflare.com/client/v4/accounts/test-account-id/d1/database/test-database-id/query"
      );
      expect(opts.method).toBe("POST");
      expect(opts.headers).toEqual({
        Authorization: "Bearer test-api-token",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(opts.body)).toEqual({
        sql: "SELECT * FROM users WHERE id = ?",
        params: [1],
      });
    });

    it("should return typed results", async () => {
      const rows = [
        { id: 1, email: "a@b.com" },
        { id: 2, email: "c@d.com" },
      ];
      mockFetch.mockResolvedValueOnce(mockD1Response(rows));

      const result = await client.query<{ id: number; email: string }>(
        "SELECT * FROM users"
      );

      expect(result.results).toEqual(rows);
      expect(result.meta.duration).toBe(0.1);
    });

    it("should handle empty results", async () => {
      mockFetch.mockResolvedValueOnce(mockD1Response([]));

      const result = await client.query("SELECT * FROM users WHERE id = ?", [
        999,
      ]);

      expect(result.results).toEqual([]);
    });

    it("should send params as empty array when not provided", async () => {
      mockFetch.mockResolvedValueOnce(mockD1Response([]));

      await client.query("SELECT 1");

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.params).toEqual([]);
    });

    it("should throw D1Error on API failure", async () => {
      const errorResponse = {
        ok: false,
        status: 500,
        json: () =>
          Promise.resolve({
            success: false,
            errors: [{ message: "database not found" }],
          }),
      };
      mockFetch.mockResolvedValueOnce(errorResponse);

      const err = await client
        .query("SELECT * FROM users")
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(D1Error);
      expect((err as D1Error).message).toBe("database not found");
      expect((err as D1Error).status).toBe(500);
    });

    it("should throw D1Error on network failure", async () => {
      mockFetch.mockRejectedValueOnce(new Error("fetch failed"));

      await expect(
        client.query("SELECT * FROM users")
      ).rejects.toThrow(D1Error);
    });

    it("should include message when fetch rejects with non-Error value", async () => {
      mockFetch.mockRejectedValueOnce("string rejection");

      const err = await client
        .query("SELECT 1")
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(D1Error);
      expect((err as D1Error).message).toBe(
        "D1 network error: string rejection",
      );
    });

    it("should fallback to D1 HTTP status when errors array is empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () =>
          Promise.resolve({
            success: false,
            errors: [],
          }),
      });

      const err = await client
        .query("SELECT 1")
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(D1Error);
      expect((err as D1Error).message).toBe("D1 HTTP 403");
      expect((err as D1Error).status).toBe(403);
    });

    it("should handle response where result[0] has no results or meta", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            result: [{}],
          }),
      });

      const result = await client.query("SELECT 1");
      expect(result.results).toEqual([]);
      expect(result.meta).toEqual({ changes: 0, duration: 0 });
    });
  });

  describe("execute()", () => {
    it("should execute write queries and return meta", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            result: [{ results: [], meta: { changes: 1, duration: 0.05 } }],
          }),
      });

      const meta = await client.execute(
        "INSERT INTO users (id, email) VALUES (?, ?)",
        ["u1", "a@b.com"]
      );

      expect(meta.changes).toBe(1);
    });
  });

  describe("batch()", () => {
    it("should send individual queries for each statement", async () => {
      mockFetch
        .mockResolvedValueOnce(
          mockD1Response([{ id: 1 }])
        )
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              result: [{ results: [], meta: { changes: 1, duration: 0.02 } }],
            }),
        });

      const results = await client.batch([
        { sql: "SELECT * FROM users WHERE id = ?", params: [1] },
        {
          sql: "INSERT INTO logs (msg) VALUES (?)",
          params: ["hello"],
        },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]!.results).toEqual([{ id: 1 }]);
      expect(results[1]!.meta.changes).toBe(1);

      // Each statement is sent as a separate request
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const body0 = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body0).toEqual({
        sql: "SELECT * FROM users WHERE id = ?",
        params: [1],
      });
      const body1 = JSON.parse(mockFetch.mock.calls[1]![1].body);
      expect(body1).toEqual({
        sql: "INSERT INTO logs (msg) VALUES (?)",
        params: ["hello"],
      });
    });

    it("should return empty array for empty batch", async () => {
      const results = await client.batch([]);

      expect(results).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should default params to empty array when omitted", async () => {
      mockFetch.mockResolvedValueOnce(mockD1Response([{ id: 1 }]));

      await client.batch([{ sql: "SELECT 1" }]);

      const body = JSON.parse(mockFetch.mock.calls[0]![1].body);
      expect(body.params).toEqual([]);
    });
  });

  describe("firstOrNull()", () => {
    it("should return first row when results exist", async () => {
      mockFetch.mockResolvedValueOnce(
        mockD1Response([{ id: 1, name: "Alice" }])
      );

      const row = await client.firstOrNull<{ id: number; name: string }>(
        "SELECT * FROM users WHERE id = ?",
        [1]
      );

      expect(row).toEqual({ id: 1, name: "Alice" });
    });

    it("should return null when no results", async () => {
      mockFetch.mockResolvedValueOnce(mockD1Response([]));

      const row = await client.firstOrNull(
        "SELECT * FROM users WHERE id = ?",
        [999]
      );

      expect(row).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// Singleton factory
// ---------------------------------------------------------------------------

describe("getD1Client / resetD1Client", () => {
  beforeEach(() => {
    resetD1Client();
    vi.stubEnv("CF_ACCOUNT_ID", "acc-123");
    vi.stubEnv("CF_D1_DATABASE_ID", "db-456");
    vi.stubEnv("CF_D1_API_TOKEN", "tok-789");
  });

  it("should return a D1Client instance", () => {
    const client = getD1Client();
    expect(client).toBeInstanceOf(D1Client);
  });

  it("should return the same singleton on second call", () => {
    const a = getD1Client();
    const b = getD1Client();
    expect(a).toBe(b);
  });

  it("should return a new instance after resetD1Client()", () => {
    const a = getD1Client();
    resetD1Client();
    const b = getD1Client();
    expect(a).not.toBe(b);
  });

  it("should read config from environment variables", () => {
    // getD1Client reads CF_ACCOUNT_ID, CF_D1_DATABASE_ID, CF_D1_API_TOKEN
    // If they are empty strings, D1Client constructor throws
    resetD1Client();
    vi.stubEnv("CF_ACCOUNT_ID", "");
    expect(() => getD1Client()).toThrow("accountId is required");
  });

  it("should fall back to empty string when env vars are undefined", () => {
    resetD1Client();
    vi.stubEnv("CF_ACCOUNT_ID", undefined as unknown as string);
    vi.stubEnv("CF_D1_DATABASE_ID", undefined as unknown as string);
    vi.stubEnv("CF_D1_API_TOKEN", undefined as unknown as string);
    expect(() => getD1Client()).toThrow("accountId is required");
  });
});
