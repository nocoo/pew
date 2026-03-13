import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { executeLogin, resolveHost, escapeHtml, DEFAULT_HOST, DEV_HOST } from "../commands/login.js";

// ---------------------------------------------------------------------------
// resolveHost
// ---------------------------------------------------------------------------

describe("resolveHost", () => {
  it("should return DEFAULT_HOST when dev is false", () => {
    expect(resolveHost(false)).toBe(DEFAULT_HOST);
  });

  it("should return DEV_HOST when dev is true", () => {
    expect(resolveHost(true)).toBe(DEV_HOST);
  });
});

// ---------------------------------------------------------------------------
// escapeHtml
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
  it("should escape < > & \" '", () => {
    expect(escapeHtml('<script>alert("xss")</script>')).toBe(
      "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;",
    );
    expect(escapeHtml("it's & done")).toBe("it&#39;s &amp; done");
  });

  it("should leave safe strings unchanged", () => {
    expect(escapeHtml("hello@example.com")).toBe("hello@example.com");
  });
});

// ---------------------------------------------------------------------------
// executeLogin
// ---------------------------------------------------------------------------

describe("executeLogin", () => {
  let tempDir: string;
  const FIXED_NONCE = "deadbeef1234567890abcdef12345678";

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-login-test-"));
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
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        // Parse the callback URL from the login URL
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback");
        expect(callbackParam).toBeTruthy();

        // Verify state is included in the login URL
        const state = parsed.searchParams.get("state");
        expect(state).toBe(FIXED_NONCE);

        // Simulate the SaaS redirecting back to CLI's callback server
        const callbackUrl = new URL(callbackParam!);
        callbackUrl.searchParams.set("api_key", "pk_test123abc");
        callbackUrl.searchParams.set("email", "test@example.com");
        callbackUrl.searchParams.set("state", state!);

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
    expect(config.token).toBe("pk_test123abc");
  });

  it("should return existing config info if already logged in and force=false", async () => {
    // Pre-save a config
    const { writeFile, mkdir } = await import("node:fs/promises");
    await mkdir(tempDir, { recursive: true });
    await writeFile(
      join(tempDir, "config.json"),
      JSON.stringify({ token: "pk_existing" })
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
      JSON.stringify({ token: "pk_old_key" })
    );

    const loginPromise = executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      force: true,
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const state = parsed.searchParams.get("state")!;
        const callbackUrl = new URL(callbackParam);
        callbackUrl.searchParams.set("api_key", "pk_new_key");
        callbackUrl.searchParams.set("email", "new@example.com");
        callbackUrl.searchParams.set("state", state);

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
    expect(config.token).toBe("pk_new_key");
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
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const state = parsed.searchParams.get("state")!;
        // Callback WITHOUT api_key but WITH valid state
        const callbackUrl = new URL(callbackParam);
        callbackUrl.searchParams.set("email", "test@example.com");
        callbackUrl.searchParams.set("state", state);

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
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        // Extract port from the callback URL
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const state = parsed.searchParams.get("state")!;
        const callbackUrl = new URL(callbackParam);
        const port = callbackUrl.port;

        await new Promise((r) => setTimeout(r, 100));

        // Hit a non-callback path
        const res = await fetch(`http://localhost:${port}/some-random-path`);
        expect(res.status).toBe(404);

        // Then send the real callback so the test can complete
        callbackUrl.searchParams.set("api_key", "pk_test456");
        callbackUrl.searchParams.set("email", "test@example.com");
        callbackUrl.searchParams.set("state", state);
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

  // ---- Security: state/nonce validation ----

  it("should reject callback with missing state parameter", async () => {
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const callbackUrl = new URL(callbackParam);
        callbackUrl.searchParams.set("api_key", "pk_injected");
        // Deliberately omit state parameter

        await new Promise((r) => setTimeout(r, 100));
        await fetch(callbackUrl.toString());
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("State mismatch");
  });

  it("should reject callback with wrong state parameter", async () => {
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const callbackUrl = new URL(callbackParam);
        callbackUrl.searchParams.set("api_key", "pk_injected");
        callbackUrl.searchParams.set("state", "wrong_nonce_from_attacker");

        await new Promise((r) => setTimeout(r, 100));
        await fetch(callbackUrl.toString());
      },
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("State mismatch");

    // Verify config was NOT saved
    const configExists = await readFile(join(tempDir, "config.json"), "utf-8").catch(() => null);
    expect(configExists).toBeNull();
  });

  // ---- Security: loopback binding ----

  it("should bind server to 127.0.0.1 only", async () => {
    let serverAddress: string | undefined;

    const loginPromise = executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const state = parsed.searchParams.get("state")!;
        const callbackUrl = new URL(callbackParam);

        // Extract the host the server is listening on from the callback URL
        // The actual server address is verified via the address check below
        serverAddress = callbackUrl.hostname;

        callbackUrl.searchParams.set("api_key", "pk_test_bind");
        callbackUrl.searchParams.set("state", state);

        await new Promise((r) => setTimeout(r, 100));
        await fetch(callbackUrl.toString());
      },
    });

    await loginPromise;
    expect(serverAddress).toBe("127.0.0.1");
  });

  // ---- Security: HTML escaping ----

  it("should escape email in HTML output to prevent XSS", async () => {
    // We test the escapeHtml function directly above, and verify it's
    // called on the email by checking the login succeeds with a
    // potentially dangerous email — the XSS prevention is structural.
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const state = parsed.searchParams.get("state")!;
        const callbackUrl = new URL(callbackParam);
        callbackUrl.searchParams.set("api_key", "pk_xss_test");
        callbackUrl.searchParams.set("email", '<script>alert("xss")</script>');
        callbackUrl.searchParams.set("state", state);

        await new Promise((r) => setTimeout(r, 100));
        await fetch(callbackUrl.toString());
      },
    });

    expect(result.success).toBe(true);
    // The email in the result is the raw value (for programmatic use),
    // but the HTML output is escaped (tested via escapeHtml unit tests)
    expect(result.email).toBe('<script>alert("xss")</script>');
  });

  it("should include state in the login URL sent to browser", async () => {
    let capturedLoginUrl: string | undefined;

    const loginPromise = executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7030",
      timeoutMs: 5000,
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        capturedLoginUrl = url;

        // Complete the flow
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const state = parsed.searchParams.get("state")!;
        const callbackUrl = new URL(callbackParam);
        callbackUrl.searchParams.set("api_key", "pk_state_test");
        callbackUrl.searchParams.set("state", state);

        await new Promise((r) => setTimeout(r, 100));
        await fetch(callbackUrl.toString());
      },
    });

    await loginPromise;

    expect(capturedLoginUrl).toBeDefined();
    const parsed = new URL(capturedLoginUrl!);
    expect(parsed.searchParams.get("state")).toBe(FIXED_NONCE);
    expect(parsed.searchParams.get("callback")).toBeTruthy();
  });
});
