import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  inMemoryRateLimiter,
  getClientIp,
  type RateLimitConfig,
} from "@/lib/rate-limit";

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

  it("global sweep prunes stale keys without affecting active ones", () => {
    vi.useFakeTimers();
    try {
      // Seed many one-shot keys (simulate transient IPs)
      for (let i = 0; i < 50; i++) {
        inMemoryRateLimiter.check(`stale-${i}`, config);
      }
      expect(inMemoryRateLimiter.size()).toBe(50);

      // Advance past the window so all seeded entries are stale
      vi.advanceTimersByTime(61_000);

      // An active key gets a fresh hit
      inMemoryRateLimiter.check("active", config);

      // Sweep is throttled to once per minute; advance another minute and
      // touch any key to trigger it
      vi.advanceTimersByTime(61_000);
      const r = inMemoryRateLimiter.check("active", config);

      // Active key still tracked; stale keys gone (active may have 1 or 2
      // depending on whether its first hit fell out of the window)
      expect(r.allowed).toBe(true);
      expect(inMemoryRateLimiter.size()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retryAfter remains correct after sweep activity", () => {
    vi.useFakeTimers();
    try {
      // Seed a stale key so a future sweep has work to do
      inMemoryRateLimiter.check("stale", config);
      vi.advanceTimersByTime(61_000);

      // Fill an active key to its limit
      inMemoryRateLimiter.check("k1", config);
      inMemoryRateLimiter.check("k1", config);
      const denied = inMemoryRateLimiter.check("k1", config);

      expect(denied.allowed).toBe(false);
      expect(denied.current).toBe(2);
      expect(denied.limit).toBe(2);
      expect(denied.retryAfter).toBeGreaterThan(0);
      expect(denied.retryAfter).toBeLessThanOrEqual(60);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a key entirely when its only timestamp expires and request is denied path is unaffected", () => {
    vi.useFakeTimers();
    try {
      inMemoryRateLimiter.check("solo", config);
      expect(inMemoryRateLimiter.size()).toBe(1);

      vi.advanceTimersByTime(61_000);

      // Re-check the same key after expiry — it should behave as fresh and
      // remain a single tracked entry, not accumulate dead arrays
      const r = inMemoryRateLimiter.check("solo", config);
      expect(r.allowed).toBe(true);
      expect(r.current).toBe(1);
      expect(inMemoryRateLimiter.size()).toBe(1);
    } finally {
      vi.useRealTimers();
    }
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
