import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createMockDbRead, makeGetRequest } from "@/__tests__/test-utils";
import type {
  DynamicPricingEntryDto,
  DynamicPricingMetaDto,
} from "@/lib/rpc-types";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

import { getDbRead } from "@/lib/db";

const { resolveUser } = (await import("@/lib/auth-helpers")) as unknown as {
  resolveUser: ReturnType<typeof vi.fn>;
};

const ENTRY: DynamicPricingEntryDto = {
  model: "anthropic/claude-sonnet-4",
  provider: "Anthropic",
  displayName: "Claude Sonnet 4",
  inputPerMillion: 3,
  outputPerMillion: 15,
  cachedPerMillion: 0.3,
  contextWindow: 200000,
  origin: "openrouter",
  updatedAt: "2026-04-30T00:00:00.000Z",
};

const META: DynamicPricingMetaDto = {
  lastSyncedAt: "2026-04-30T00:00:00.000Z",
  modelCount: 1,
  baselineCount: 0,
  openRouterCount: 1,
  modelsDevCount: 0,
  lastErrors: null,
};

describe("GET /api/pricing/models", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(resolveUser).mockResolvedValue({ userId: "u1" });
  });

  it("returns 401 when unauthenticated", async () => {
    vi.mocked(resolveUser).mockResolvedValueOnce(null);
    const res = await GET(makeGetRequest("/api/pricing/models"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns entries + meta + servedFrom for any logged-in user (no admin gate)", async () => {
    mockDbRead.getDynamicPricing.mockResolvedValueOnce({
      entries: [ENTRY],
      servedFrom: "kv",
    } as never);
    mockDbRead.getDynamicPricingMeta.mockResolvedValueOnce(META as never);

    const res = await GET(makeGetRequest("/api/pricing/models"));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: DynamicPricingEntryDto[];
      servedFrom: string;
      meta: DynamicPricingMetaDto;
    };
    expect(body.entries).toEqual([ENTRY]);
    expect(body.servedFrom).toBe("kv");
    expect(body.meta).toEqual(META);
  });

  it("sets cache-control: private, no-store", async () => {
    mockDbRead.getDynamicPricing.mockResolvedValueOnce({
      entries: [],
      servedFrom: "baseline",
    } as never);
    mockDbRead.getDynamicPricingMeta.mockResolvedValueOnce(META as never);
    const res = await GET(makeGetRequest("/api/pricing/models"));
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("returns 503 with fallback shape when worker-read throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbRead.getDynamicPricing.mockRejectedValueOnce(
      new Error("worker-read unreachable"),
    );
    mockDbRead.getDynamicPricingMeta.mockResolvedValueOnce(META as never);

    const res = await GET(makeGetRequest("/api/pricing/models"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: string;
      fallback: { entries: unknown[]; meta: null };
    };
    expect(body.error).toBe("Failed to load dynamic pricing");
    expect(body.fallback).toEqual({ entries: [], meta: null });
    consoleSpy.mockRestore();
  });
});
