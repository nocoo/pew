import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkShowcaseRateLimit,
  SHOWCASE_CREATE_RATE_LIMIT,
  inMemoryRateLimiter,
  getClientIp,
  type RateLimitConfig,
} from "@/lib/rate-limit";
import type { DbRead } from "@/lib/db";

// ---------------------------------------------------------------------------
// Mock setup
// ---------------------------------------------------------------------------

function createMockDbRead(count: number): DbRead {
  return {
    firstOrNull: vi.fn().mockResolvedValue({ count }),
    first: vi.fn(),
    query: vi.fn(),
  } as unknown as DbRead;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkShowcaseRateLimit", () => {
  const defaultConfig: RateLimitConfig = {
    maxRequests: 5,
    windowSeconds: 3600,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows request when under limit", async () => {
    const dbRead = createMockDbRead(2);
    const result = await checkShowcaseRateLimit(dbRead, "user-1", defaultConfig);

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(2);
    expect(result.limit).toBe(5);
    expect(result.retryAfter).toBe(0);
  });

  it("allows request when at limit - 1", async () => {
    const dbRead = createMockDbRead(4);
    const result = await checkShowcaseRateLimit(dbRead, "user-1", defaultConfig);

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(4);
  });

  it("denies request when at limit", async () => {
    const dbRead = createMockDbRead(5);
    const result = await checkShowcaseRateLimit(dbRead, "user-1", defaultConfig);

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(5);
    expect(result.limit).toBe(5);
    expect(result.retryAfter).toBe(3600);
  });

  it("denies request when over limit", async () => {
    const dbRead = createMockDbRead(10);
    const result = await checkShowcaseRateLimit(dbRead, "user-1", defaultConfig);

    expect(result.allowed).toBe(false);
    expect(result.current).toBe(10);
  });

  it("allows request when count is 0", async () => {
    const dbRead = createMockDbRead(0);
    const result = await checkShowcaseRateLimit(dbRead, "user-1", defaultConfig);

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(0);
  });

  it("handles null result from query", async () => {
    const dbRead = {
      firstOrNull: vi.fn().mockResolvedValue(null),
    } as unknown as DbRead;

    const result = await checkShowcaseRateLimit(dbRead, "user-1", defaultConfig);

    expect(result.allowed).toBe(true);
    expect(result.current).toBe(0);
  });

  it("queries with correct time window", async () => {
    const dbRead = createMockDbRead(0);
    const now = Date.now();
    vi.setSystemTime(now);

    await checkShowcaseRateLimit(dbRead, "user-1", defaultConfig);

    const expectedWindowStart = new Date(now - 3600 * 1000).toISOString();
    expect(dbRead.firstOrNull).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = ? AND created_at >= ?"),
      ["user-1", expectedWindowStart]
    );

    vi.useRealTimers();
  });

  it("uses custom config values", async () => {
    const dbRead = createMockDbRead(2);
    const customConfig: RateLimitConfig = {
      maxRequests: 3,
      windowSeconds: 60,
    };

    const result = await checkShowcaseRateLimit(dbRead, "user-1", customConfig);

    expect(result.allowed).toBe(true);
    expect(result.limit).toBe(3);
  });

  it("denies with custom config when over limit", async () => {
    const dbRead = createMockDbRead(3);
    const customConfig: RateLimitConfig = {
      maxRequests: 3,
      windowSeconds: 60,
    };

    const result = await checkShowcaseRateLimit(dbRead, "user-1", customConfig);

    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBe(60);
  });
});

describe("SHOWCASE_CREATE_RATE_LIMIT", () => {
  it("has correct default values", () => {
    expect(SHOWCASE_CREATE_RATE_LIMIT.maxRequests).toBe(20);
    expect(SHOWCASE_CREATE_RATE_LIMIT.windowSeconds).toBe(3600);
  });
});

// ---------------------------------------------------------------------------
// InMemoryRateLimiter
// ---------------------------------------------------------------------------

describe("inMemoryRateLimiter", () => {
  const config: RateLimitConfig = { maxRequests: 2, windowSeconds: 60 };

  beforeEach(() => {
    inMemoryRateLimiter.reset();
  });

  it("allows requests under limit", () => {
    const r1 = inMemoryRateLimiter.check("k1", config);
    expect(r1.allowed).toBe(true);
    expect(r1.current).toBe(1);
  });

  it("denies requests at limit and returns retryAfter > 0", () => {
    inMemoryRateLimiter.check("k1", config);
    inMemoryRateLimiter.check("k1", config);
    const r3 = inMemoryRateLimiter.check("k1", config);
    expect(r3.allowed).toBe(false);
    expect(r3.current).toBe(2);
    expect(r3.retryAfter).toBeGreaterThan(0);
  });

  it("prunes expired timestamps and allows again", () => {
    vi.useFakeTimers();
    inMemoryRateLimiter.check("k1", config);
    inMemoryRateLimiter.check("k1", config);

    vi.advanceTimersByTime(61_000);

    const r = inMemoryRateLimiter.check("k1", config);
    expect(r.allowed).toBe(true);
    expect(r.current).toBe(1);
    vi.useRealTimers();
  });

  it("tracks different keys independently", () => {
    inMemoryRateLimiter.check("k1", config);
    inMemoryRateLimiter.check("k1", config);
    const r = inMemoryRateLimiter.check("k2", config);
    expect(r.allowed).toBe(true);
    expect(r.current).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getClientIp
// ---------------------------------------------------------------------------

describe("getClientIp", () => {
  it("returns first IP from x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("falls through when x-forwarded-for is present but first entry is empty", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": " , 5.6.7.8", "x-real-ip": "9.9.9.9" },
    });
    expect(getClientIp(req)).toBe("9.9.9.9");
  });

  it("returns x-real-ip when no x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": " 10.0.0.1 " },
    });
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("returns cf-connecting-ip as last resort", () => {
    const req = new Request("http://localhost", {
      headers: { "cf-connecting-ip": "172.16.0.1" },
    });
    expect(getClientIp(req)).toBe("172.16.0.1");
  });

  it("returns 'unknown' when no proxy headers present", () => {
    const req = new Request("http://localhost");
    expect(getClientIp(req)).toBe("unknown");
  });
});
