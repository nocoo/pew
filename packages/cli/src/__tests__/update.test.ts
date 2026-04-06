import { describe, it, expect } from "vitest";
import { executeUpdate } from "../commands/update.js";

describe("executeUpdate", () => {
  it("should return success when command succeeds", async () => {
    const result = await executeUpdate({
      currentVersion: "1.0.0",
      execFn: async () => ({
        stdout: "added 1 package, changed 1 package in 2s\n",
        stderr: "",
      }),
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("added 1 package");
    expect(result.error).toBeUndefined();
  });

  it("should return failure when command throws", async () => {
    const result = await executeUpdate({
      currentVersion: "1.0.0",
      execFn: async () => {
        throw new Error("EACCES: permission denied");
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("EACCES");
  });

  it("should combine stdout and stderr in output", async () => {
    const result = await executeUpdate({
      currentVersion: "1.0.0",
      execFn: async () => ({
        stdout: "added 1 package\n",
        stderr: "npm warn deprecated\n",
      }),
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain("added 1 package");
    expect(result.output).toContain("npm warn deprecated");
  });

  it("should execute a valid update command string", async () => {
    let capturedCmd = "";

    await executeUpdate({
      currentVersion: "1.0.0",
      execFn: async (cmd) => {
        capturedCmd = cmd;
        return { stdout: "", stderr: "" };
      },
    });

    // detectPackageManager may return null (fallback) or an actual pm
    // The command should be one of: npm install -g, bun update -g, pnpm update -g, yarn global upgrade
    expect(capturedCmd).toMatch(/@nocoo\/pew/);
    expect(capturedCmd).toMatch(/(npm|bun|pnpm|yarn)/);
  });
});
