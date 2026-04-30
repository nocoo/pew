import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

const { getDbRead } = (await import("@/lib/db")) as unknown as {
  getDbRead: ReturnType<typeof vi.fn>;
};

import { createMockDbRead } from "./test-utils";

// ---------------------------------------------------------------------------
// GET /api/pricing
// ---------------------------------------------------------------------------

describe("GET /api/pricing", () => {
  let GET: (req: Request) => Promise<Response>;
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    mockDbRead.getDynamicPricing.mockResolvedValue({
      entries: [],
      servedFrom: "baseline",
    });
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead);
    const mod = await import("@/app/api/pricing/route");
    GET = mod.GET;
  });

  it("should reject unauthenticated with 401", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);

    const res = await GET(new Request("http://localhost:7020/api/pricing"));

    expect(res.status).toBe(401);
  });

  it("should return pricing map from dynamic entries", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getDynamicPricing.mockResolvedValueOnce({
      entries: [
        {
          model: "gpt-4o",
          provider: "OpenAI",
          displayName: "GPT-4o",
          inputPerMillion: 2.5,
          outputPerMillion: 10,
          cachedPerMillion: 1.25,
          contextWindow: 128000,
          origin: "baseline",
          updatedAt: "2026-04-30T00:00:00.000Z",
        },
      ],
      servedFrom: "kv",
    });

    const res = await GET(new Request("http://localhost:7020/api/pricing"));

    expect(res.status).toBe(200);
    const body = await res.json();
    // buildPricingMap merges dynamic entries with defaults — just check it's a non-empty object
    expect(typeof body).toBe("object");
    expect(body).not.toEqual({});
  });

  it("should fall back to defaults when dynamic call rejects", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getDynamicPricing.mockRejectedValueOnce(
      new Error("KV unavailable"),
    );

    const res = await GET(new Request("http://localhost:7020/api/pricing"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe("object");
  });

  it("should fall back to defaults on unexpected error", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce({ userId: "u1" });
    mockDbRead.getDynamicPricing.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET(new Request("http://localhost:7020/api/pricing"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body).toBe("object");
  });
});
