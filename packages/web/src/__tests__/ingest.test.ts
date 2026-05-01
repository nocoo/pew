import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/ingest/route";
import { loadMockedAuthHelpers } from "./test-utils";

// Mock resolveUser from auth-helpers
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = await loadMockedAuthHelpers();

// Mock global fetch for Worker proxy calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeRequest(body: unknown, token?: string, clientVersion?: string): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  if (clientVersion) {
    headers["X-Pew-Client-Version"] = clientVersion;
  }
  return new Request("http://localhost:7020/api/ingest", {
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
  total_tokens: 1700,
};

/** Version that satisfies the server-side MIN_CLIENT_VERSION gate */
const VALID_VERSION = "1.6.0";

/** Stub a successful Worker response */
function stubWorkerOk(ingested = 1) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ ingested }), { status: 200 }),
  );
}

/** Stub a failed Worker response */
function stubWorkerError(status = 500, error = "D1 batch failed") {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ error }), { status }),
  );
}

describe("POST /api/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      stubWorkerOk();

      const res = await POST(makeRequest([VALID_RECORD], undefined, VALID_VERSION));

      expect(res.status).toBe(200);
    });

    it("should accept requests resolved via api_key", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce({
        userId: "u2",
        email: "apikey@example.com",
      });
      stubWorkerOk();

      const res = await POST(makeRequest([VALID_RECORD], "pk_abc123", VALID_VERSION));

      expect(res.status).toBe(200);
      // Verify Worker was called with userId from resolveUser
      const [, fetchInit] = mockFetch.mock.calls[0]!;
      const sentBody = JSON.parse(fetchInit.body as string);
      expect(sentBody.userId).toBe("u2");
    });

    it("should use userId from resolveUser in Worker request", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce({
        userId: "u1",
        email: "test@example.com",
      });
      stubWorkerOk();

      const res = await POST(makeRequest([VALID_RECORD], "pk_some_key", VALID_VERSION));

      expect(res.status).toBe(200);
      const [, fetchInit] = mockFetch.mock.calls[0]!;
      const sentBody = JSON.parse(fetchInit.body as string);
      expect(sentBody.userId).toBe("u1");
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
      const res = await POST(makeRequest({ not: "array" }, undefined, VALID_VERSION));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("array");
    });

    it("should reject empty array", async () => {
      const res = await POST(makeRequest([], undefined, VALID_VERSION));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("empty");
    });

    it("should reject records with invalid source", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_RECORD, source: "invalid-tool" }], undefined, VALID_VERSION)
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("source");
    });

    it("should reject records with missing model", async () => {
      const { model: _, ...noModel } = VALID_RECORD;
      const res = await POST(makeRequest([noModel], undefined, VALID_VERSION));

      expect(res.status).toBe(400);
    });

    it("should reject records with invalid hour_start format", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_RECORD, hour_start: "not-a-date" }], undefined, VALID_VERSION)
      );

      expect(res.status).toBe(400);
    });

    it("should reject records with negative token values", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_RECORD, input_tokens: -1 }], undefined, VALID_VERSION)
      );

      expect(res.status).toBe(400);
    });

    it("should reject oversized batches (> 50 records)", async () => {
      const records = Array.from({ length: 51 }, () => ({
        ...VALID_RECORD,
      }));
      const res = await POST(makeRequest(records, undefined, VALID_VERSION));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("50");
    });

    it("should not call Worker for invalid requests", async () => {
      const res = await POST(makeRequest([], undefined, VALID_VERSION));

      expect(res.status).toBe(400);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("worker proxy", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should forward records to Worker via fetch", async () => {
      stubWorkerOk();

      const res = await POST(makeRequest([VALID_RECORD], undefined, VALID_VERSION));

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledOnce();

      const [, fetchInit] = mockFetch.mock.calls[0]!;
      expect(fetchInit.method).toBe("POST");
      expect(fetchInit.headers["Content-Type"]).toBe("application/json");
      expect(fetchInit.headers["Authorization"]).toContain("Bearer ");

      const sentBody = JSON.parse(fetchInit.body as string);
      expect(sentBody.userId).toBe("u1");
      expect(sentBody.records).toHaveLength(1);
      expect(sentBody.records[0].source).toBe("claude-code");
    });

    it("should forward multiple records in a single request", async () => {
      stubWorkerOk(3);

      const records = [
        VALID_RECORD,
        { ...VALID_RECORD, source: "gemini-cli", model: "gemini-2.5-pro" },
        { ...VALID_RECORD, source: "opencode", model: "o3" },
      ];
      const res = await POST(makeRequest(records, undefined, VALID_VERSION));

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledOnce();

      const [, fetchInit] = mockFetch.mock.calls[0]!;
      const sentBody = JSON.parse(fetchInit.body as string);
      expect(sentBody.records).toHaveLength(3);
    });

    it("should return ingested count in response", async () => {
      stubWorkerOk(2);

      const res = await POST(makeRequest([VALID_RECORD, VALID_RECORD], undefined, VALID_VERSION));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ingested).toBe(2);
    });

    it("should return 500 when Worker returns error", async () => {
      stubWorkerError(500, "D1 batch failed: table not found");

      const res = await POST(makeRequest([VALID_RECORD], undefined, VALID_VERSION));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("ingest");
    });

    it("should return 500 when fetch itself throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const res = await POST(makeRequest([VALID_RECORD], undefined, VALID_VERSION));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("ingest");
    });
  });

  describe("version gate", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should reject requests without X-Pew-Client-Version header", async () => {
      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Client version too old");
      expect(body.error).toContain("pew reset");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should reject requests with version below MIN_CLIENT_VERSION", async () => {
      const res = await POST(makeRequest([VALID_RECORD], undefined, "1.5.1"));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Client version too old");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should accept requests with version equal to MIN_CLIENT_VERSION", async () => {
      stubWorkerOk();

      const res = await POST(makeRequest([VALID_RECORD], undefined, "1.6.0"));

      expect(res.status).toBe(200);
    });

    it("should accept requests with version above MIN_CLIENT_VERSION", async () => {
      stubWorkerOk();

      const res = await POST(makeRequest([VALID_RECORD], undefined, "2.0.0"));

      expect(res.status).toBe(200);
    });

    it("should check version after auth (unauthenticated gets 401, not 400)", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      // No version header, but auth should fail first
      const res = await POST(makeRequest([VALID_RECORD]));

      expect(res.status).toBe(401);
    });
  });
});
