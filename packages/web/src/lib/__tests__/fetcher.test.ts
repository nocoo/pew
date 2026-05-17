import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetcher } from "../fetcher";

describe("fetcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON for a successful 200 response", async () => {
    const payload = { id: "x", value: 42 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const result = await fetcher<typeof payload>("/api/test");
    expect(result).toEqual(payload);
  });

  it("throws via throwApiError for a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ message: "nope" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    // throwApiError always throws — the exact error shape isn't part of the
    // fetcher contract; we just assert a throw occurred.
    await expect(fetcher("/api/fail")).rejects.toBeInstanceOf(Error);
  });

  it("propagates fetch-level rejection (network failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    await expect(fetcher("/api/x")).rejects.toThrow("network down");
  });
});
