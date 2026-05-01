import { beforeEach, describe, expect, it, vi } from "vitest";
import * as dbModule from "@/lib/db";
import { GET } from "./route";
import {
  createMockDbRead,
  loadMockedAuthHelpers,
  makeGetRequest,
} from "@/__tests__/test-utils";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
  getDbWrite: vi.fn(),
  resetDb: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
  resolveUser: vi.fn(),
}));

const { resolveUser } = await loadMockedAuthHelpers();

describe("GET /api/usage route edge cases", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(dbModule.getDbRead).mockResolvedValue(mockDbRead as never);
    vi.mocked(resolveUser).mockResolvedValue({
      userId: "u1",
      email: "test@example.com",
    });
  });

  it("rejects unsupported granularity values", async () => {
    const res = await GET(
      makeGetRequest("/api/usage", { granularity: "month" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid granularity parameter",
    });
    expect(mockDbRead.getUsageRecords).not.toHaveBeenCalled();
  });

  it("rejects invalid to date formats before querying the DB", async () => {
    const res = await GET(
      makeGetRequest("/api/usage", { to: "tomorrow-ish" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid to date format",
    });
    expect(mockDbRead.getUsageRecords).not.toHaveBeenCalled();
  });

  it("rejects non-numeric tzOffset values", async () => {
    const res = await GET(
      makeGetRequest("/api/usage", { tzOffset: "abc" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid tzOffset value",
    });
    expect(mockDbRead.getUsageRecords).not.toHaveBeenCalled();
  });

  it("rejects tzOffset outside the +/- 840 range", async () => {
    const res = await GET(
      makeGetRequest("/api/usage", { tzOffset: "900" }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Invalid tzOffset value",
    });
    expect(mockDbRead.getUsageRecords).not.toHaveBeenCalled();
  });
});
