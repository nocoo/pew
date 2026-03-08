import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, buildMultiRowUpsert } from "@/app/api/ingest/route";
import * as d1Module from "@/lib/d1";

// Mock getD1Client
vi.mock("@/lib/d1", async (importOriginal) => {
  const original = await importOriginal<typeof d1Module>();
  return {
    ...original,
    getD1Client: vi.fn(),
  };
});

// Mock resolveUser from auth-helpers
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = await import("@/lib/auth-helpers") as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

function createMockClient() {
  return {
    query: vi.fn(),
    execute: vi.fn(),
    batch: vi.fn(),
    firstOrNull: vi.fn(),
  };
}

function makeRequest(body: unknown, token?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return new Request("http://localhost:7030/api/ingest", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_RECORD = {
  source: "claude-code",
  model: "claude-sonnet-4-20250514",
  hour_start: "2026-03-07T10:30:00.000Z",
  input_tokens: 1000,
  cached_input_tokens: 200,
  output_tokens: 500,
  reasoning_output_tokens: 0,
  total_tokens: 1500,
};

describe("POST /api/ingest", () => {
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();
    vi.mocked(d1Module.getD1Client).mockReturnValue(
      mockClient as unknown as d1Module.D1Client
    );
  });

  describe("authentication", () => {
    it("should reject requests without auth", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should accept authenticated requests (session)", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce({
        userId: "u1",
        email: "test@example.com",
      });
      mockClient.execute.mockResolvedValueOnce({ changes: 1, duration: 5 });

      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(200);
    });

    it("should accept requests resolved via api_key", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce({
        userId: "u2",
        email: "apikey@example.com",
      });
      mockClient.execute.mockResolvedValueOnce({ changes: 1, duration: 5 });

      const res = await POST(makeRequest([VALID_RECORD], "zk_abc123"));

      expect(res.status).toBe(200);
      // Verify execute was called with params containing the user_id
      const [, params] = mockClient.execute.mock.calls[0]!;
      expect(params).toContain("u2");
    });

    it("should use userId from resolveUser in upsert statement", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce({
        userId: "u1",
        email: "test@example.com",
      });
      mockClient.execute.mockResolvedValueOnce({ changes: 1, duration: 5 });

      const res = await POST(makeRequest([VALID_RECORD], "zk_some_key"));

      expect(res.status).toBe(200);
      const [, params] = mockClient.execute.mock.calls[0]!;
      expect(params).toContain("u1");
    });
  });

  describe("validation", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should reject non-array body", async () => {
      const res = await POST(makeRequest({ not: "array" }));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("array");
    });

    it("should reject empty array", async () => {
      const res = await POST(makeRequest([]));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("empty");
    });

    it("should reject records with invalid source", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_RECORD, source: "invalid-tool" }])
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("source");
    });

    it("should reject records with missing model", async () => {
      const { model: _, ...noModel } = VALID_RECORD;
      const res = await POST(makeRequest([noModel]));

      expect(res.status).toBe(400);
    });

    it("should reject records with invalid hour_start format", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_RECORD, hour_start: "not-a-date" }])
      );

      expect(res.status).toBe(400);
    });

    it("should reject records with negative token values", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_RECORD, input_tokens: -1 }])
      );

      expect(res.status).toBe(400);
    });

    it("should reject oversized batches (> 300 records)", async () => {
      const records = Array.from({ length: 301 }, () => ({
        ...VALID_RECORD,
      }));
      const res = await POST(makeRequest(records));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("300");
    });
  });

  describe("upsert", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should call execute with a single multi-row INSERT", async () => {
      mockClient.execute.mockResolvedValueOnce({ changes: 1, duration: 5 });

      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(200);
      expect(mockClient.execute).toHaveBeenCalledOnce();
      expect(mockClient.batch).not.toHaveBeenCalled();

      const [sql, params] = mockClient.execute.mock.calls[0]!;
      expect(sql).toContain("INSERT INTO usage_records");
      expect(sql).toContain("ON CONFLICT");
      // Additive semantics — tokens accumulate on conflict
      expect(sql).toContain("usage_records.input_tokens + excluded.input_tokens");
      expect(sql).toContain("usage_records.total_tokens + excluded.total_tokens");
      expect(params).toContain("u1"); // user_id
      expect(params).toContain("claude-code"); // source
    });

    it("should build multi-row VALUES for multiple records", async () => {
      mockClient.execute.mockResolvedValueOnce({ changes: 3, duration: 10 });

      const records = [
        VALID_RECORD,
        { ...VALID_RECORD, source: "gemini-cli", model: "gemini-2.5-pro" },
        { ...VALID_RECORD, source: "opencode", model: "o3" },
      ];
      const res = await POST(makeRequest(records));

      expect(res.status).toBe(200);

      const [sql, params] = mockClient.execute.mock.calls[0]!;
      // 3 records × 9 columns = 27 params
      expect(params).toHaveLength(27);
      // SQL should have 3 value tuples
      const valueMatches = sql.match(/\([\s,?]+\)/g);
      expect(valueMatches).toHaveLength(3);
    });

    it("should return ingested count in response", async () => {
      mockClient.execute.mockResolvedValueOnce({ changes: 2, duration: 5 });

      const res = await POST(makeRequest([VALID_RECORD, VALID_RECORD]));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ingested).toBe(2);
    });

    it("should return 500 on D1 failure", async () => {
      mockClient.execute.mockRejectedValueOnce(new Error("D1 unavailable"));

      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("ingest");
    });
  });
});

// ---------------------------------------------------------------------------
// Unit tests for buildMultiRowUpsert
// ---------------------------------------------------------------------------

describe("buildMultiRowUpsert", () => {
  it("should build correct SQL for a single record", () => {
    const { sql, params } = buildMultiRowUpsert("u1", [
      {
        source: "claude-code",
        model: "sonnet",
        hour_start: "2026-03-07T10:00:00.000Z",
        input_tokens: 100,
        cached_input_tokens: 20,
        output_tokens: 50,
        reasoning_output_tokens: 0,
        total_tokens: 150,
      },
    ]);

    expect(sql).toContain("INSERT INTO usage_records");
    expect(sql).toContain("VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    expect(sql).toContain("ON CONFLICT");
    // Additive accumulation semantics
    expect(sql).toContain("usage_records.input_tokens + excluded.input_tokens");
    expect(sql).toContain("usage_records.total_tokens + excluded.total_tokens");
    expect(params).toEqual([
      "u1", "claude-code", "sonnet", "2026-03-07T10:00:00.000Z",
      100, 20, 50, 0, 150,
    ]);
  });

  it("should build correct SQL for multiple records", () => {
    const { sql, params } = buildMultiRowUpsert("u1", [
      {
        source: "claude-code",
        model: "sonnet",
        hour_start: "2026-03-07T10:00:00.000Z",
        input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 50,
        reasoning_output_tokens: 0,
        total_tokens: 150,
      },
      {
        source: "gemini-cli",
        model: "gemini-2.5-pro",
        hour_start: "2026-03-07T11:00:00.000Z",
        input_tokens: 200,
        cached_input_tokens: 10,
        output_tokens: 100,
        reasoning_output_tokens: 0,
        total_tokens: 300,
      },
    ]);

    // 2 rows × 9 columns = 18 params
    expect(params).toHaveLength(18);
    // SQL should contain two value tuples
    const valueSection = sql.split("VALUES")[1]!.split("ON CONFLICT")[0]!;
    const tupleCount = (valueSection.match(/\(/g) ?? []).length;
    expect(tupleCount).toBe(2);
    // Both user_ids should be "u1"
    expect(params[0]).toBe("u1");
    expect(params[9]).toBe("u1");
    // Second record source
    expect(params[10]).toBe("gemini-cli");
  });

  it("should use additive accumulation on conflict", () => {
    const { sql } = buildMultiRowUpsert("u1", [
      {
        source: "claude-code",
        model: "sonnet",
        hour_start: "2026-03-07T10:00:00.000Z",
        input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 50,
        reasoning_output_tokens: 0,
        total_tokens: 150,
      },
    ]);

    // Each token field should accumulate on conflict
    expect(sql).toContain("usage_records.input_tokens + excluded.input_tokens");
    expect(sql).toContain("usage_records.cached_input_tokens + excluded.cached_input_tokens");
    expect(sql).toContain("usage_records.output_tokens + excluded.output_tokens");
    expect(sql).toContain("usage_records.reasoning_output_tokens + excluded.reasoning_output_tokens");
    expect(sql).toContain("usage_records.total_tokens + excluded.total_tokens");
  });
});
