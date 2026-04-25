import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { createMockDbRead } from "@/__tests__/test-utils";

vi.mock("@/lib/db", () => ({
  getDbRead: vi.fn(),
}));

import { getDbRead } from "@/lib/db";

describe("GET /api/auth/invite-required", () => {
  let mockDbRead: ReturnType<typeof createMockDbRead>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDbRead = createMockDbRead();
    vi.mocked(getDbRead).mockResolvedValue(mockDbRead as never);
  });

  it("returns required=true when setting is unset (default)", async () => {
    mockDbRead.getAppSetting.mockResolvedValueOnce(null);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ required: true });
    expect(res.headers.get("Cache-Control")).toContain("public");
  });

  it("returns required=false only when setting is exactly the string 'false'", async () => {
    mockDbRead.getAppSetting.mockResolvedValueOnce("false");

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ required: false });
  });

  it("returns required=true when setting is any other truthy string", async () => {
    mockDbRead.getAppSetting.mockResolvedValueOnce("true");

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ required: true });
  });

  it("returns required=true and no Cache-Control when table is missing", async () => {
    mockDbRead.getAppSetting.mockRejectedValueOnce(
      new Error("no such table: app_settings"),
    );

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ required: true });
    // Fallback path skips the SWR Cache-Control header
    expect(res.headers.get("Cache-Control") ?? "").not.toContain("s-maxage");
  });

  it("returns required=true and logs on unexpected error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbRead.getAppSetting.mockRejectedValueOnce(new Error("D1 down"));

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ required: true });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("treats a non-Error throwable as an unexpected error (defaults to required)", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDbRead.getAppSetting.mockRejectedValueOnce("string error");

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ required: true });
    consoleSpy.mockRestore();
  });
});
