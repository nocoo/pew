import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/ingest/route";
import * as d1Module from "@/lib/d1";

// Mock getD1Client
vi.mock("@/lib/d1", async (importOriginal) => {
  const original = await importOriginal<typeof d1Module>();
  return {
    ...original,
    getD1Client: vi.fn(),
  };
});

// Mock auth — we need to mock the auth module to control session
vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

// Use dynamic import to get the mock after vi.mock is hoisted
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auth } = await import("@/auth") as unknown as {
  auth: ReturnType<typeof vi.fn>;
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
      vi.mocked(auth).mockResolvedValueOnce(null);

      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should accept authenticated requests", async () => {
      vi.mocked(auth).mockResolvedValueOnce({
        user: { id: "u1", email: "test@example.com" },
        expires: "2026-12-31",
      } as never);
      mockClient.batch.mockResolvedValueOnce([]);

      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(200);
    });

    it("should accept requests with valid Bearer api_key", async () => {
      // No session — auth returns null
      vi.mocked(auth).mockResolvedValueOnce(null);
      // But Bearer token lookup succeeds
      mockClient.firstOrNull.mockResolvedValueOnce({ id: "u2" });
      mockClient.batch.mockResolvedValueOnce([]);

      const res = await POST(makeRequest([VALID_RECORD], "zk_abc123"));

      expect(res.status).toBe(200);
      // Verify user_id from api_key lookup was used
      const statements = mockClient.batch.mock.calls[0]![0];
      expect(statements[0].params).toContain("u2");
    });

    it("should reject requests with invalid Bearer api_key", async () => {
      vi.mocked(auth).mockResolvedValueOnce(null);
      // Bearer token lookup returns no user
      mockClient.firstOrNull.mockResolvedValueOnce(null);

      const res = await POST(makeRequest([VALID_RECORD], "zk_invalid"));

      expect(res.status).toBe(401);
    });

    it("should prefer session auth over Bearer token", async () => {
      // Both session and Bearer present — session takes priority
      vi.mocked(auth).mockResolvedValueOnce({
        user: { id: "u1", email: "test@example.com" },
        expires: "2026-12-31",
      } as never);
      mockClient.batch.mockResolvedValueOnce([]);

      const res = await POST(makeRequest([VALID_RECORD], "zk_some_key"));

      expect(res.status).toBe(200);
      // Should use session user, not api_key lookup
      const statements = mockClient.batch.mock.calls[0]![0];
      expect(statements[0].params).toContain("u1");
      // firstOrNull should NOT have been called for api_key lookup
      expect(mockClient.firstOrNull).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    beforeEach(() => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "test@example.com" },
        expires: "2026-12-31",
      } as never);
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

    it("should reject oversized batches (> 1000 records)", async () => {
      const records = Array.from({ length: 1001 }, () => ({
        ...VALID_RECORD,
      }));
      const res = await POST(makeRequest(records));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("1000");
    });
  });

  describe("upsert", () => {
    beforeEach(() => {
      vi.mocked(auth).mockResolvedValue({
        user: { id: "u1", email: "test@example.com" },
        expires: "2026-12-31",
      } as never);
    });

    it("should upsert records into D1", async () => {
      mockClient.batch.mockResolvedValueOnce([]);

      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(200);
      expect(mockClient.batch).toHaveBeenCalledOnce();

      const statements = mockClient.batch.mock.calls[0]![0];
      expect(statements).toHaveLength(1);
      expect(statements[0].sql).toContain("INSERT");
      expect(statements[0].sql).toContain("ON CONFLICT");
      expect(statements[0].params).toContain("u1"); // user_id
      expect(statements[0].params).toContain("claude-code"); // source
    });

    it("should handle multiple records in batch", async () => {
      mockClient.batch.mockResolvedValueOnce([]);

      const records = [
        VALID_RECORD,
        { ...VALID_RECORD, source: "gemini-cli", model: "gemini-2.5-pro" },
        { ...VALID_RECORD, source: "opencode", model: "o3" },
      ];
      const res = await POST(makeRequest(records));

      expect(res.status).toBe(200);
      const statements = mockClient.batch.mock.calls[0]![0];
      expect(statements).toHaveLength(3);
    });

    it("should return ingested count in response", async () => {
      mockClient.batch.mockResolvedValueOnce([]);

      const res = await POST(makeRequest([VALID_RECORD, VALID_RECORD]));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ingested).toBe(2);
    });

    it("should return 500 on D1 failure", async () => {
      mockClient.batch.mockRejectedValueOnce(new Error("D1 unavailable"));

      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("ingest");
    });
  });
});
