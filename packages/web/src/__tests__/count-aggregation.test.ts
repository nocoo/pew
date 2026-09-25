import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockDbRead, makeGetRequest } from "./test-utils";
import { GET as usage } from "@/app/api/usage/route";
import { GET as sessions } from "@/app/api/sessions/route";
import { GET as profile } from "@/app/api/users/[slug]/route";
import { GET as storage } from "@/app/api/admin/storage/route";
import { GET as compare } from "@/app/api/admin/usage/compare/route";
import { GET as devices } from "@/app/api/usage/by-device/route";
import { getDbRead } from "@/lib/db";

vi.mock("@/lib/db", () => ({ getDbRead: vi.fn() }));
vi.mock("@/lib/auth-helpers", () => ({ resolveUser: vi.fn(async () => ({ userId: "u1", email: "a@test.invalid" })) }));
vi.mock("@/lib/admin", () => ({ resolveAdmin: vi.fn(async () => ({ userId: "u1", email: "a@test.invalid" })) }));
vi.mock("@/lib/load-pricing-map", () => ({ loadPricingMap: vi.fn(async () => ({ models: { test: { input: 0.1, output: 0.2, cached: 0.01 } }, prefixes: [], sourceDefaults: {} })) }));

let db: ReturnType<typeof createMockDbRead>;
beforeEach(() => {
  vi.clearAllMocks();
  db = createMockDbRead();
  vi.mocked(getDbRead).mockResolvedValue(db);
});

describe("Web aggregation of individually safe historical counts", () => {
  it.each(["usage", "profile", "sessions", "storage", "compare", "devices"] as const)("enforces exact sums in %s", async (route) => {
    for (const safe of [true, false]) {
      const counts = [2 ** 52, 2 ** 52 + (safe ? -1 : 1)];
      const records = counts.map((n) => ({ source: "codex", model: "test", input_tokens: n, cached_input_tokens: 0,
        output_tokens: 0, reasoning_output_tokens: 0, total_tokens: n, duration_seconds: n,
        user_messages: 0, assistant_messages: 0, total_messages: 0, session_count: 0, usage_row_count: 0, total_duration_seconds: 0,
        date: "2026-09-25", user_id: "u1" }));
      db.getUsageRecords.mockResolvedValue(records);
      db.getSessionRecords.mockResolvedValue(records);
      db.getPublicUserBySlugOrId.mockResolvedValue({ id: "u1", is_public: 1 });
      db.getAdminStorageStats.mockResolvedValue(records);
      db.getAdminUsersByIds.mockResolvedValue([{ id: "u1" }, { id: "u2" }]);
      db.getAdminUsageComparison.mockResolvedValue(records);
      db.getDeviceSummary.mockResolvedValue([]);
      db.getDeviceTimeline.mockResolvedValue([]);
      db.getDeviceCostDetails.mockResolvedValue([{ ...records[0], output_tokens: counts[1] }]);
      const request = makeGetRequest("/api/fixture", { userIds: "u1,u2" });
      const response = route === "profile" ? await profile(request, { params: Promise.resolve({ slug: "fixture" }) })
        : await ({ usage, sessions, storage, compare, devices } as const)[route](request);
      expect(response.status).toBe(safe ? 200 : 500);
      const body = await response.json();
      if (safe) {
        const totals = { usage: body.summary?.total_tokens, profile: body.summary?.total_tokens,
          sessions: body.summary?.total_duration_seconds, storage: body.summary?.total_tokens,
          compare: body.daily?.[0]?.users.u1, devices: body.deviceDetails?.[0]?.total_tokens };
        expect(totals[route]).toBe(Number.MAX_SAFE_INTEGER);
      } else expect(body).toHaveProperty("error");
    }
  });
});
