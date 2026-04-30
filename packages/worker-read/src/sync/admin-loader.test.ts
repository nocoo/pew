import { describe, it, expect, vi, beforeEach } from "vitest";
import type { D1Database } from "@cloudflare/workers-types";

import { loadAdminRows } from "./admin-loader";

function mockDb(allImpl: () => Promise<{ results: unknown[] }>) {
  return {
    prepare: vi.fn().mockReturnValue({ all: allImpl }),
  } as unknown as D1Database;
}

describe("admin-loader", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("empty table → rows=[], error=null", async () => {
    const db = mockDb(async () => ({ results: [] }));
    expect(await loadAdminRows(db)).toEqual({ rows: [], error: null });
  });

  it("maps mixed source=null and source='codex' rows", async () => {
    const db = mockDb(async () => ({
      results: [
        { model: "gpt-4o", source: null, input: 2.5, output: 10, cached: 1.25 },
        { model: "gpt-4o", source: "codex", input: 7, output: 21, cached: 1.5 },
      ],
    }));
    expect(await loadAdminRows(db)).toEqual({
      rows: [
        { model: "gpt-4o", source: null, input: 2.5, output: 10, cached: 1.25 },
        { model: "gpt-4o", source: "codex", input: 7, output: 21, cached: 1.5 },
      ],
      error: null,
    });
  });

  it("D1 throws → returns rows=[] with error message and logs", async () => {
    const db = mockDb(async () => {
      throw new Error("D1 down");
    });
    const result = await loadAdminRows(db);
    expect(result.rows).toEqual([]);
    expect(result.error).toBe("D1 down");
    expect(errSpy).toHaveBeenCalled();
  });
});
