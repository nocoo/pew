import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, getPublicOrigin } from "@/app/api/auth/cli/route";
import { createMockDbRead, createMockDbWrite } from "./test-utils";
import * as dbModule from "@/lib/db";
import { inMemoryRateLimiter } from "@/lib/rate-limit";

// Mock db
vi.mock("@/lib/db", async (importOriginal) => {
  const original = await importOriginal<typeof dbModule>();
  return {
    ...original,
    getDbRead: vi.fn(),
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
  let mockDbRead: ReturnType<typeof createMockDbRead>;
  let mockDbWrite: ReturnType<typeof createMockDbWrite>;

  beforeEach(() => {
    vi.clearAllMocks();
    inMemoryRateLimiter.reset();
    mockDbRead = createMockDbRead();
    mockDbWrite = createMockDbWrite();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(
      mockDbRead as unknown as dbModule.DbRead
    );
    vi.mocked(dbModule.getDbWrite).mockResolvedValue(
      mockDbWrite as unknown as dbModule.DbWrite
    );
  });

  describe("getPublicOrigin", () => {
    it("should use NEXTAUTH_URL when set", () => {
      const orig = process.env.NEXTAUTH_URL;
      process.env.NEXTAUTH_URL = "https://pew.md";
      try {
        const req = new Request("http://0.0.0.0:8080/api/auth/cli", {
          headers: {
            "x-forwarded-host": "pew.md",
            "x-forwarded-proto": "https",
          },
        });
        // Uses NEXTAUTH_URL, ignores forwarded headers
        expect(getPublicOrigin(req)).toBe("https://pew.md");
      } finally {
        if (orig === undefined) {
          delete process.env.NEXTAUTH_URL;
        } else {
          process.env.NEXTAUTH_URL = orig;
        }
      }
    });

    it("should strip trailing slash from NEXTAUTH_URL", () => {
      const orig = process.env.NEXTAUTH_URL;
      process.env.NEXTAUTH_URL = "https://pew.md/";
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

    it("should ignore x-forwarded-host (security: no header trust)", () => {
      const orig = process.env.NEXTAUTH_URL;
      delete process.env.NEXTAUTH_URL;
      try {
        const req = new Request("http://0.0.0.0:8080/api/auth/cli", {
          headers: {
            "x-forwarded-host": "evil.com",
            "x-forwarded-proto": "https",
          },
        });
        // Falls back to request URL, ignoring forwarded headers
        expect(getPublicOrigin(req)).toBe("http://0.0.0.0:8080");
      } finally {
        if (orig === undefined) {
          delete process.env.NEXTAUTH_URL;
        } else {
          process.env.NEXTAUTH_URL = orig;
        }
      }
    });

    it("should fall back to request URL origin when NEXTAUTH_URL is not set", () => {
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
      const orig = process.env.NEXTAUTH_URL;
      process.env.NEXTAUTH_URL = "https://pew.md";
      try {
        vi.mocked(resolveUser).mockResolvedValueOnce(null);

        const req = new Request(
          "http://0.0.0.0:8080/api/auth/cli?callback=" +
            encodeURIComponent("http://localhost:9999/callback"),
        );
        const res = await GET(req);

        expect(res.status).toBe(307);
        const location = res.headers.get("Location")!;
        // Should use NEXTAUTH_URL origin, not forwarded headers
        expect(location.startsWith("https://pew.md/login")).toBe(true);
        expect(location).not.toContain("0.0.0.0");
      } finally {
        if (orig === undefined) {
          delete process.env.NEXTAUTH_URL;
        } else {
          process.env.NEXTAUTH_URL = orig;
        }
      }
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

    it("should reject unparseable callback URLs", async () => {
      const res = await GET(makeRequest("not-a-valid-url"));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("Invalid callback URL");
    });

    it("should reject non-localhost callback URLs", async () => {
      const res = await GET(makeRequest("https://evil.com/steal"));

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("localhost");
    });

    it("should accept localhost callback URLs", async () => {
      mockDbRead.getUserApiKey.mockResolvedValueOnce("existing-key-123");

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location).toContain("localhost:9999");
      expect(location).toContain("api_key=existing-key-123");
    });

    it("should accept 127.0.0.1 callback URLs", async () => {
      mockDbRead.getUserApiKey.mockResolvedValueOnce("existing-key-456");

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

    it("should reuse existing api_key if user already has one", async () => {
      mockDbRead.getUserApiKey.mockResolvedValueOnce("existing-key-abc");

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location).toContain("api_key=existing-key-abc");
      // Should NOT have called execute to generate a new key
      expect(mockDbWrite.execute).not.toHaveBeenCalled();
    });

    it("should generate new api_key if user has none", async () => {
      mockDbRead.getUserApiKey.mockResolvedValueOnce(null);
      mockDbWrite.execute.mockResolvedValueOnce(undefined);

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location).toContain("api_key=");
      // Should have called execute to save new key
      expect(mockDbWrite.execute).toHaveBeenCalledOnce();
      expect(mockDbWrite.execute.mock.calls[0]![0]).toContain(
        "UPDATE users SET api_key"
      );
    });

    it("should include email in callback redirect", async () => {
      vi.mocked(resolveUser).mockResolvedValue({
        userId: "u1",
        email: "test@example.com",
      });
      mockDbRead.getUserApiKey.mockResolvedValueOnce("key-xyz");

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      const location = res.headers.get("Location")!;
      expect(location).toContain("email=test%40example.com");
    });

    it("should forward state parameter in callback redirect", async () => {
      mockDbRead.getUserApiKey.mockResolvedValueOnce("key-xyz");

      const res = await GET(
        makeRequest("http://localhost:9999/callback", "my-nonce-123")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location).toContain("state=my-nonce-123");
      expect(location).toContain("api_key=key-xyz");
    });

    it("should omit state from redirect when not provided", async () => {
      mockDbRead.getUserApiKey.mockResolvedValueOnce("key-xyz");

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      expect(res.status).toBe(307);
      const location = res.headers.get("Location")!;
      expect(location).not.toContain("state=");
    });

    it("should return 500 on D1 failure", async () => {
      mockDbRead.getUserApiKey.mockRejectedValueOnce(new Error("D1 down"));

      const res = await GET(
        makeRequest("http://localhost:9999/callback")
      );

      expect(res.status).toBe(500);
    });
  });
});
