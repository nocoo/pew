/**
 * Direct unit tests for coordinator-helpers.ts.
 *
 * These tests exercise the helpers in isolation. The helpers are also
 * indirectly exercised via coordinator.test.ts, but coverage attribution
 * after the extraction sits on this file rather than coordinator.ts.
 */
import { describe, it, expect, vi } from "vitest";
import type { CoordinatorRunResult } from "@pew/core";
import {
  deriveStatus,
  toErrorMessage,
  readLastSuccessAt,
  readSignalSize,
  appendSignal,
  truncateSignal,
} from "../notifier/coordinator-helpers.js";

function baseResult(overrides: Partial<CoordinatorRunResult> = {}): CoordinatorRunResult {
  return {
    waitedForLock: false,
    skippedSync: false,
    cycles: [],
    ...overrides,
  };
}

describe("deriveStatus", () => {
  it("returns 'skipped' when skippedSync is true", () => {
    expect(deriveStatus(baseResult({ skippedSync: true }))).toBe("skipped");
  });

  it("returns 'error' when run-level error with no cycles", () => {
    expect(deriveStatus(baseResult({ error: "boom" }))).toBe("error");
  });

  it("returns 'skipped' when no cycles and no error", () => {
    expect(deriveStatus(baseResult())).toBe("skipped");
  });

  it("returns 'partial' when some cycles errored and some succeeded", () => {
    expect(
      deriveStatus(
        baseResult({
          cycles: [
            { trigger: "interval" as const, tokenSync: { uploaded: 1, attempted: 1 } },
            { trigger: "signal" as const, tokenSyncError: "fail" },
          ],
        }),
      ),
    ).toBe("partial");
  });

  it("returns 'error' when all cycles errored (no success)", () => {
    expect(
      deriveStatus(
        baseResult({
          cycles: [{ trigger: "interval" as const, tokenSyncError: "fail" }],
        }),
      ),
    ).toBe("error");
  });

  it("returns 'success' when all cycles succeeded with no error", () => {
    expect(
      deriveStatus(
        baseResult({
          cycles: [
            { trigger: "interval" as const, tokenSync: { uploaded: 1, attempted: 1 } },
          ],
        }),
      ),
    ).toBe("success");
  });
});

describe("toErrorMessage", () => {
  it("returns Error.message for Error instances", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns String(value) for non-Error values", () => {
    expect(toErrorMessage("raw string")).toBe("raw string");
    expect(toErrorMessage(42)).toBe("42");
    expect(toErrorMessage(null)).toBe("null");
  });
});

describe("readLastSuccessAt", () => {
  it("returns the trimmed content of last-success.json when present", async () => {
    const fs = { readFile: vi.fn().mockResolvedValue("  2026-05-01T00:00:00Z  ") };
    expect(await readLastSuccessAt("/state", fs)).toBe("2026-05-01T00:00:00Z");
  });

  it("returns null when the file is empty (after trim)", async () => {
    const fs = { readFile: vi.fn().mockResolvedValue("   \n  ") };
    expect(await readLastSuccessAt("/state", fs)).toBeNull();
  });

  it("returns null when the file is missing (readFile throws)", async () => {
    const fs = { readFile: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })) };
    expect(await readLastSuccessAt("/state", fs)).toBeNull();
  });
});

describe("signal helpers", () => {
  it("readSignalSize returns file.size when stat succeeds", async () => {
    const fs = { stat: vi.fn().mockResolvedValue({ size: 42 }) };
    expect(await readSignalSize("/state", fs)).toBe(42);
  });

  it("readSignalSize returns 0 on ENOENT", async () => {
    const fs = { stat: vi.fn().mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" })) };
    expect(await readSignalSize("/state", fs)).toBe(0);
  });

  it("readSignalSize re-throws non-ENOENT errors", async () => {
    const fs = { stat: vi.fn().mockRejectedValue(Object.assign(new Error("permission denied"), { code: "EACCES" })) };
    await expect(readSignalSize("/state", fs)).rejects.toThrow("permission denied");
  });

  it("appendSignal writes a newline to notify.signal", async () => {
    const fs = { appendFile: vi.fn().mockResolvedValue(undefined) };
    await appendSignal("/state", fs);
    expect(fs.appendFile).toHaveBeenCalledWith(expect.stringContaining("notify.signal"), "\n");
  });

  it("truncateSignal writes an empty string to notify.signal", async () => {
    const fs = { writeFile: vi.fn().mockResolvedValue(undefined) };
    await truncateSignal("/state", fs);
    expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining("notify.signal"), "");
  });
});
