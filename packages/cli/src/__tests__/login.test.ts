import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { executeLogin } from "../commands/login.js";

describe("executeLogin", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "zebra-login-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("should save api_key to config after successful callback", async () => {
    // Simulate: browser callback sends api_key
    const loginPromise = executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      openBrowser: async (url) => {
        // Parse the callback URL from the login URL
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback");
        expect(callbackParam).toBeTruthy();

        // Simulate the SaaS redirecting back to CLI's callback server
        const callbackUrl = new URL(callbackParam!);
        callbackUrl.searchParams.set("api_key", "zk_test123abc");
        callbackUrl.searchParams.set("email", "test@example.com");

        // Small delay to let server start
        await new Promise((r) => setTimeout(r, 100));
        await fetch(callbackUrl.toString());
      },
    });

    const result = await loginPromise;

    expect(result.success).toBe(true);
    expect(result.email).toBe("test@example.com");

    // Verify config was saved
    const config = JSON.parse(
      await readFile(join(tempDir, "config.json"), "utf-8")
    );
    expect(config.token).toBe("zk_test123abc");
  });

  it("should return existing config info if already logged in and force=false", async () => {
    // Pre-save a config
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, "config.json"),
      JSON.stringify({ token: "zk_existing" })
    );

    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      openBrowser: async () => {
        throw new Error("Should not open browser");
      },
    });

    expect(result.success).toBe(true);
    expect(result.alreadyLoggedIn).toBe(true);
  });

  it("should re-login when force=true even if already logged in", async () => {
    // Pre-save a config
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, "config.json"),
      JSON.stringify({ token: "zk_old_key" })
    );

    const loginPromise = executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      force: true,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const callbackUrl = new URL(callbackParam);
        callbackUrl.searchParams.set("api_key", "zk_new_key");
        callbackUrl.searchParams.set("email", "new@example.com");

        await new Promise((r) => setTimeout(r, 100));
        await fetch(callbackUrl.toString());
      },
    });

    const result = await loginPromise;

    expect(result.success).toBe(true);
    expect(result.email).toBe("new@example.com");

    const config = JSON.parse(
      await readFile(join(tempDir, "config.json"), "utf-8")
    );
    expect(config.token).toBe("zk_new_key");
  });

  it("should timeout if no callback received", async () => {
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 500,
      openBrowser: async () => {
        // Do nothing — simulate user not completing login
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });

  it("should fail if callback has no api_key", async () => {
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        // Callback WITHOUT api_key
        const callbackUrl = new URL(callbackParam);
        callbackUrl.searchParams.set("email", "test@example.com");

        await new Promise((r) => setTimeout(r, 100));
        await fetch(callbackUrl.toString());
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("api_key");
  });

  it("should return 404 for non-callback requests", async () => {
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 2000,
      openBrowser: async (url) => {
        // Extract port from the callback URL
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const callbackUrl = new URL(callbackParam);
        const port = callbackUrl.port;

        await new Promise((r) => setTimeout(r, 100));

        // Hit a non-callback path
        const res = await fetch(`http://localhost:${port}/some-random-path`);
        expect(res.status).toBe(404);

        // Then send the real callback so the test can complete
        callbackUrl.searchParams.set("api_key", "zk_test456");
        callbackUrl.searchParams.set("email", "test@example.com");
        await fetch(callbackUrl.toString());
      },
    });

    expect(result.success).toBe(true);
    expect(result.email).toBe("test@example.com");
  });

  it("should fail if openBrowser rejects", async () => {
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      openBrowser: async () => {
        throw new Error("xdg-open not found");
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to open browser");
    expect(result.error).toContain("xdg-open not found");
  });
});
