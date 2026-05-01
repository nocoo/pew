import { describe, it, expect, vi, beforeEach } from "vitest";
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
  return new Request("http://localhost:7020/api/ingest/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_SESSION = {
  session_key: "claude-code:abc123",
  source: "claude-code",
  kind: "human",
  started_at: "2026-03-08T10:00:00Z",
  last_message_at: "2026-03-08T10:30:00Z",
  duration_seconds: 1800,
  user_messages: 12,
  assistant_messages: 10,
  total_messages: 25,
  project_ref: "a1b2c3",
  model: "claude-sonnet-4-20250514",
  snapshot_at: "2026-03-08T11:00:00Z",
};

/** Version that satisfies the server-side MIN_CLIENT_VERSION gate */
const VALID_VERSION = "1.6.0";

function stubWorkerOk(ingested = 1) {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ ingested }), { status: 200 }),
  );
}

function stubWorkerError(status = 500, error = "D1 batch failed") {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ error }), { status }),
  );
}

describe("POST /api/ingest/sessions", () => {
  let POST: (req: Request) => Promise<Response>;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Dynamic import to get the route handler
    const mod = await import("@/app/api/ingest/sessions/route");
    POST = mod.POST;
  });

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  describe("authentication", () => {
    it("should reject requests without auth with 401", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const res = await POST(makeRequest([VALID_SESSION]));

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe("Unauthorized");
    });

    it("should accept authenticated requests", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce({
        userId: "u1",
        email: "test@example.com",
      });
      stubWorkerOk();

      const res = await POST(makeRequest([VALID_SESSION], undefined, VALID_VERSION));

      expect(res.status).toBe(200);
    });
  });

  // -----------------------------------------------------------------------
  // Validation
  // -----------------------------------------------------------------------

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

    it("should reject oversized batches (> 50 records)", async () => {
      const records = Array.from({ length: 51 }, () => ({
        ...VALID_SESSION,
      }));
      const res = await POST(makeRequest(records, undefined, VALID_VERSION));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("50");
    });

    it("should reject records with invalid source", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_SESSION, source: "invalid-tool" }], undefined, VALID_VERSION),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("source");
    });

    it("should reject records with missing session_key", async () => {
      const { session_key: _, ...noKey } = VALID_SESSION;
      const res = await POST(makeRequest([noKey], undefined, VALID_VERSION));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("session_key");
    });

    it("should reject records with invalid kind", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_SESSION, kind: "invalid" }], undefined, VALID_VERSION),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("kind");
    });

    it("should reject records with non-ISO started_at", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_SESSION, started_at: "not-a-date" }], undefined, VALID_VERSION),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("started_at");
    });

    it("should reject records with negative duration_seconds", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_SESSION, duration_seconds: -1 }], undefined, VALID_VERSION),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("duration_seconds");
    });

    it("should reject records with non-number user_messages", async () => {
      const res = await POST(
        makeRequest([{ ...VALID_SESSION, user_messages: "ten" }], undefined, VALID_VERSION),
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("user_messages");
    });

    it("should accept records with null project_ref", async () => {
      stubWorkerOk();
      const res = await POST(
        makeRequest([{ ...VALID_SESSION, project_ref: null }], undefined, VALID_VERSION),
      );

      expect(res.status).toBe(200);
    });

    it("should accept records with null model", async () => {
      stubWorkerOk();
      const res = await POST(
        makeRequest([{ ...VALID_SESSION, model: null }], undefined, VALID_VERSION),
      );

      expect(res.status).toBe(200);
    });

    it("should not call Worker for invalid requests", async () => {
      const res = await POST(makeRequest([], undefined, VALID_VERSION));

      expect(res.status).toBe(400);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Worker proxy
  // -----------------------------------------------------------------------

  describe("worker proxy", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should forward records to Worker /ingest/sessions", async () => {
      stubWorkerOk();

      const res = await POST(makeRequest([VALID_SESSION], undefined, VALID_VERSION));

      expect(res.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledOnce();

      const [url, fetchInit] = mockFetch.mock.calls[0]!;
      // Worker URL should target /ingest/sessions
      expect(url).toContain("/ingest/sessions");
      expect(fetchInit.method).toBe("POST");
      expect(fetchInit.headers["Content-Type"]).toBe("application/json");
      expect(fetchInit.headers["Authorization"]).toContain("Bearer ");

      const sentBody = JSON.parse(fetchInit.body as string);
      expect(sentBody.userId).toBe("u1");
      expect(sentBody.records).toHaveLength(1);
      expect(sentBody.records[0].session_key).toBe("claude-code:abc123");
    });

    it("should forward multiple records in a single request", async () => {
      stubWorkerOk(3);

      const records = [
        VALID_SESSION,
        { ...VALID_SESSION, session_key: "gemini-cli:def456" },
        { ...VALID_SESSION, session_key: "opencode:ghi789" },
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

      const res = await POST(makeRequest([VALID_SESSION, VALID_SESSION], undefined, VALID_VERSION));

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ingested).toBe(2);
    });

    it("should return 500 when Worker returns error", async () => {
      stubWorkerError(500, "D1 batch failed: table not found");

      const res = await POST(makeRequest([VALID_SESSION], undefined, VALID_VERSION));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("ingest");
    });

    it("should return 500 when fetch itself throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const res = await POST(makeRequest([VALID_SESSION], undefined, VALID_VERSION));

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toContain("ingest");
    });

    it("should derive /sessions URL from WORKER_INGEST_URL ending with /ingest", async () => {
      vi.stubEnv(
        "WORKER_INGEST_URL",
        "https://worker.example.com/ingest",
      );
      stubWorkerOk();

      const res = await POST(makeRequest([VALID_SESSION], undefined, VALID_VERSION));

      expect(res.status).toBe(200);
      const [url] = mockFetch.mock.calls[0]!;
      expect(url).toBe("https://worker.example.com/ingest/sessions");
    });
  });
});
