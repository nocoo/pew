import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createMockDbRead, makeGetRequest } from "@/__tests__/test-utils";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
}));

vi.mock("@/lib/seasons", () => ({
  deriveSeasonStatus: vi.fn(),
}));

import { getDbRead } from "@/lib/db";
import { deriveSeasonStatus } from "@/lib/seasons";

describe("GET /api/seasons route edge cases", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead as never);
  });

  it("sorts seasons by start date within the same computed status group", async () => {
    mockDbRead.listSeasons.mockResolvedValueOnce([
      {
        id: "ended-old",
        name: "Ended old",
        slug: "ended-old",
        start_date: "2025-01-01",
        end_date: "2025-02-01",
        team_count: 1,
        has_snapshot: 0,
        allow_late_registration: 0,
        allow_late_withdrawal: 0,
        created_at: "2025-01-01T00:00:00Z",
      },
      {
        id: "active",
        name: "Active",
        slug: "active",
        start_date: "2026-06-01",
        end_date: "2026-07-01",
        team_count: 3,
        has_snapshot: 1,
        allow_late_registration: 1,
        allow_late_withdrawal: 0,
        created_at: "2026-06-01T00:00:00Z",
      },
      {
        id: "ended-new",
        name: "Ended new",
        slug: "ended-new",
        start_date: "2025-03-01",
        end_date: "2025-04-01",
        team_count: 2,
        has_snapshot: 1,
        allow_late_registration: 0,
        allow_late_withdrawal: 1,
        created_at: "2025-03-01T00:00:00Z",
      },
    ]);

    vi.mocked(deriveSeasonStatus).mockImplementation((startDate) => {
      if (startDate === "2026-06-01") {
        return "active";
      }
      return "ended";
    });

    const res = await GET(makeGetRequest("/api/seasons"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seasons.map((season: { id: string }) => season.id)).toEqual([
      "active",
      "ended-new",
      "ended-old",
    ]);
  });

  it("returns an empty list when the seasons table is missing", async () => {
    mockDbRead.listSeasons.mockRejectedValueOnce(new Error("no such table: seasons"));

    const res = await GET(makeGetRequest("/api/seasons"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ seasons: [] });
  });

  it("returns 500 for unexpected database failures", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbRead.listSeasons.mockRejectedValueOnce(new Error("connection refused"));

    const res = await GET(makeGetRequest("/api/seasons"));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to list seasons" });
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
