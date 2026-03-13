import { describe, it, expect } from "vitest";
import { executeUpdate } from "../commands/update.js";

describe("executeUpdate", () => {
  it("should return success when npm install succeeds", async () => {
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

  it("should return failure when npm install throws", async () => {
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

  it("should pass correct args to exec", async () => {
    let capturedCmd = "";
    let capturedArgs: string[] = [];

    await executeUpdate({
      currentVersion: "1.0.0",
      execFn: async (cmd, args) => {
        capturedCmd = cmd;
        capturedArgs = args;
        return { stdout: "", stderr: "" };
      },
    });

    expect(capturedCmd).toBe("npm");
    expect(capturedArgs).toEqual(["install", "-g", "@nocoo/pew@latest"]);
  });
});
