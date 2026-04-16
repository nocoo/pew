import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeLogout } from "../commands/logout.js";

// Mock ConfigManager to test error path
vi.mock("../config/manager.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../config/manager.js")>();
  return {
    ...original,
    ConfigManager: original.ConfigManager,
  };
});

describe("executeLogout", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-logout-test-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns alreadyLoggedOut when no token exists", async () => {
    const result = await executeLogout({ configDir: tempDir });
    expect(result.success).toBe(true);
    expect(result.alreadyLoggedOut).toBe(true);
  });

  it("clears token from config", async () => {
    await writeFile(
      join(tempDir, "config.json"),
      JSON.stringify({ token: "zb_test123" }),
    );

    const result = await executeLogout({ configDir: tempDir });
    expect(result.success).toBe(true);
    expect(result.alreadyLoggedOut).toBeUndefined();
  });

  it("uses dev config when dev=true", async () => {
    await writeFile(
      join(tempDir, "config.dev.json"),
      JSON.stringify({ token: "zb_dev456" }),
    );

    const result = await executeLogout({ configDir: tempDir, dev: true });
    expect(result.success).toBe(true);
    expect(result.alreadyLoggedOut).toBeUndefined();
  });

  it("returns error with message when an Error is thrown", async () => {
    const { ConfigManager } = await import("../config/manager.js");
    vi.spyOn(ConfigManager.prototype, "load").mockRejectedValueOnce(
      new Error("disk exploded"),
    );

    const result = await executeLogout({ configDir: tempDir });
    expect(result.success).toBe(false);
    expect(result.error).toBe("disk exploded");
  });

  it("returns generic error for non-Error throws", async () => {
    const { ConfigManager } = await import("../config/manager.js");
    vi.spyOn(ConfigManager.prototype, "load").mockRejectedValueOnce(
      "string error",
    );

    const result = await executeLogout({ configDir: tempDir });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to clear credentials");
  });
});
