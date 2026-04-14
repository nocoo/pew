import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, getPublicOrigin } from "@/app/api/auth/cli/route";
import { createMockDbWrite } from "./test-utils";
import * as dbModule from "@/lib/db";

// Mock db
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof dbModule>();
  return {
    ...original,
    getDbWrite: vi.fn(),
  };
});

// Mock resolveUser
vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
  E2E_TEST_USER_ID: "e2e-test-user-id",
  E2E_TEST_USER_EMAIL: "e2e@test.local",
}));

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

function makeRequest(callback?: string, state?: string): Request {
  let url = "http://localhost:7020/api/auth/cli";
  const params = new URLSearchParams();
  if (callback) params.set("callback", callback);
  if (state) params.set("state", state);
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return new Request(url, { method: "GET" });
}

describe("GET /api/auth/cli", () => {
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(
      mockDbWrite as unknown as dbModule.DbWrite
    );
  });

  describe("getPublicOrigin", () => {
    it("should use x-forwarded-host and x-forwarded-proto", () => {
      const req = new Request("http://0.0.0.0:8080/api/auth/cli", {
        headers: {
          "x-forwarded-host": "pew.md",
          "x-forwarded-proto": "https",
        },
      });
      expect(getPublicOrigin(req)).toBe("https://pew.md");
    });

    it("should default to https when x-forwarded-proto is absent", () => {
      const req = new Request("http://0.0.0.0:8080/api/auth/cli", {
        headers: {
          "x-forwarded-host": "pew.md",
        },
      });
      expect(getPublicOrigin(req)).toBe("https://pew.md");
    });

    it("should fall back to NEXTAUTH_URL", () => {
      const orig = process.env.NEXTAUTH_URL;
      process.env.NEXTAUTH_URL = "https://pew.md";
      try {
        const req = new Request("http://0.0.0.0:8080/api/auth/cli");
        expect(getPublicOrigin(req)).toBe("https://pew.md");
      } finally {
        if (orig === undefined) {
          delete process.env.NEXTAUTH_URL;
        } else {
          process.env.NEXTAUTH_URL = orig;
        }
      }
    });

    it("should fall back to request URL origin", () => {
      const orig = process.env.NEXTAUTH_URL;
      delete process.env.NEXTAUTH_URL;
      try {
        const req = new Request("http://localhost:7020/api/auth/cli");
        expect(getPublicOrigin(req)).toBe("http://localhost:7020");
      } finally {
        if (orig === undefined) {
          delete process.env.NEXTAUTH_URL;
        } else {
          process.env.NEXTAUTH_URL = orig;
        }
      }
    });
  });

  describe("authentication", () => {
    it("should redirect unauthenticated requests to login", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const res = await GET(makeRequest("http://localhost:9999/callback"));

      // Should redirect to login page with return URL
      expect(res.status).toBe(307);
      const location = res.headers.get("Location");
      expect(location).toContain("/login");
    });

    it("should use public origin for unauthenticated redirect", async () => {
      vi.mocked(resolveUser).mockResolvedValueOnce(null);

      const req = new Request(
        "http://0.0.0.0:8080/api/auth/cli?callback=" +
          encodeURIComponent("http://localhost:9999/callback"),
        {
          headers: {
            "x-forwarded-host": "pew.md",
            "x-forwarded-proto": "https",
          },
        }
      );
      const res = await GET(req);

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location.startsWith("https://pew.md/login")).toBe(true);
      expect(location).not.toContain("0.0.0.0");
    });
  });

  describe("validation", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should reject requests without callback parameter", async () => {
      const res = await GET(makeRequest());

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("callback");
    });

    it("should reject non-localhost callback URLs", async () => {
      const res = await GET(makeRequest("https://evil.com/steal"));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("localhost");
    });

    it("should accept localhost callback URLs", async () => {
      mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location).toContain("localhost:9999");
      // API key is in query string (readable by CLI local server)
      expect(location).toContain("api_key=pk_");
    });

    it("should accept 127.0.0.1 callback URLs", async () => {
      mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

      const res = await GET(
        makeRequest("http://127.0.0.1:8888/callback")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location).toContain("127.0.0.1:8888");
    });
  });

  describe("api key generation", () => {
    beforeEach(() => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
    });

    it("should always generate a fresh api_key (key rotation)", async () => {
      mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      // API key is in query string
      expect(location).toContain("api_key=pk_");
      // Should have called execute to save new hashed key
      expect(mockDbWrite.execute).toHaveBeenCalledOnce();
      expect(mockDbWrite.execute.mock.calls[0]![0]).toContain(
        "UPDATE users SET api_key"
      );
      // Stored value should be a hash, not the raw key
      expect(mockDbWrite.execute.mock.calls[0]![1]![0]).toMatch(
        /^hash:[a-f0-9]{64}$/
      );
      // No conditional WHERE api_key IS NULL — always overwrites
      expect(mockDbWrite.execute.mock.calls[0]![0]).not.toContain(
        "api_key IS NULL"
      );
    });

    it("should include email in callback redirect query string", async () => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
      mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      const location = res.headers.get("Location")!;
      expect(location).toContain("email=test%40example.com");
    });

    it("should forward state parameter in callback redirect", async () => {
      mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

      const res = await GET(
        makeRequest("http://localhost:9999/callback", "my-nonce-123")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location).toContain("state=my-nonce-123");
      expect(location).toContain("api_key=pk_");
    });

    it("should omit state from redirect when not provided", async () => {
      mockDbWrite.execute.mockResolvedValueOnce({ changes: 1 });

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location).not.toContain("state=");
    });

    it("should return 500 on DB failure", async () => {
      mockDbWrite.execute.mockRejectedValueOnce(new Error("DB down"));

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      expect(res.status).toBe(500);
    });
  });
});
