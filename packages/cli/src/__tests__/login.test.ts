import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { executeLogin, resolveHost, DEFAULT_HOST, DEV_HOST } from "../commands/login.js";

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
      apiUrl: "http://localhost:7020",
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
      apiUrl: "http://localhost:7020",
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
      apiUrl: "http://localhost:7020",
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
      apiUrl: "http://localhost:7020",
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
      apiUrl: "http://localhost:7020",
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
      apiUrl: "http://localhost:7020",
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

  it("should timeout when browser open fails (cli-base logs but continues)", async () => {
    // cli-base performLogin logs a message when browser fails but doesn't reject
    // It still waits for the timeout since user could manually open the URL
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7020",
      timeoutMs: 500, // Short timeout
      openBrowser: async () => {
        throw new Error("xdg-open not found");
      },
    });

    // Login times out because no callback was received
    expect(result.success).toBe(false);
    expect(result.error).toContain("timeout");
  });

  // ---- Security: state/nonce validation ----

  it("should reject callback with missing state parameter", async () => {
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7020",
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
    expect(result.error).toContain("CSRF");
  });

  it("should reject callback with wrong state parameter", async () => {
    const result = await executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7020",
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
    expect(result.error).toContain("CSRF");

    // Verify config was NOT saved
    const configExists = await readFile(join(tempDir, "config.json"), "utf-8").catch(() => null);
    expect(configExists).toBeNull();
  });

  // ---- Security: loopback binding ----

  it("should bind server to localhost only", async () => {
    let serverAddress: string | undefined;

    const loginPromise = executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7020",
      timeoutMs: 5000,
      generateNonce: () => FIXED_NONCE,
      openBrowser: async (url) => {
        const parsed = new URL(url);
        const callbackParam = parsed.searchParams.get("callback")!;
        const state = parsed.searchParams.get("state")!;
        const callbackUrl = new URL(callbackParam);

        // Extract the host the server is listening on from the callback URL
        serverAddress = callbackUrl.hostname;

        callbackUrl.searchParams.set("api_key", "pk_test_bind");
        callbackUrl.searchParams.set("state", state);

        await new Promise((r) => setTimeout(r, 100));
        await fetch(callbackUrl.toString());
      },
    });

    await loginPromise;
    expect(serverAddress).toBe("localhost");
  });

  it("should include state in the login URL sent to browser", async () => {
    let capturedLoginUrl: string | undefined;

    const loginPromise = executeLogin({
      configDir: tempDir,
      apiUrl: "http://localhost:7020",
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

  // ---- Code-based login (headless) ----

  describe("code-based login", () => {
    it("should authenticate successfully with valid code", async () => {
      const mockFetch = async (url: string, init?: RequestInit) => {
        expect(url).toBe("http://localhost:7020/api/auth/code/verify");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(init?.body as string);
        expect(body.code).toBe("ABCD-1234");

        return new Response(JSON.stringify({
          api_key: "pk_from_code",
          email: "headless@example.com",
        }), { status: 200 });
      };

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "ABCD-1234",
        fetch: mockFetch as typeof globalThis.fetch,
        openBrowser: async () => {
          throw new Error("Should not open browser");
        },
      });

      expect(result.success).toBe(true);
      expect(result.email).toBe("headless@example.com");

      // Verify config was saved
      const config = JSON.parse(
        await readFile(join(tempDir, "config.json"), "utf-8")
      );
      expect(config.token).toBe("pk_from_code");
    });

    it("should fail with invalid code", async () => {
      const mockFetch = async () => {
        return new Response(JSON.stringify({
          error: "Invalid code",
        }), { status: 401 });
      };

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "INVALID",
        fetch: mockFetch as typeof globalThis.fetch,
        openBrowser: async () => {
          throw new Error("Should not open browser");
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid code");
    });

    it("should fail with expired code", async () => {
      const mockFetch = async () => {
        return new Response(JSON.stringify({
          error: "Code expired",
        }), { status: 401 });
      };

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "EXPIRED",
        fetch: mockFetch as typeof globalThis.fetch,
        openBrowser: async () => {
          throw new Error("Should not open browser");
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Code expired");
    });

    it("should fail with already-used code", async () => {
      const mockFetch = async () => {
        return new Response(JSON.stringify({
          error: "Code already used",
        }), { status: 401 });
      };

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "USED",
        fetch: mockFetch as typeof globalThis.fetch,
        openBrowser: async () => {
          throw new Error("Should not open browser");
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Code already used");
    });

    it("should handle network errors gracefully", async () => {
      const mockFetch = async () => {
        throw new Error("Network unreachable");
      };

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "ABCD-1234",
        fetch: mockFetch as typeof globalThis.fetch,
        openBrowser: async () => {
          throw new Error("Should not open browser");
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network unreachable");
    });

    it("should skip browser flow when code is provided", async () => {
      let browserOpened = false;

      const mockFetch = async () => {
        return new Response(JSON.stringify({
          api_key: "pk_code_only",
          email: "code@example.com",
        }), { status: 200 });
      };

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "ABCD-5678",
        fetch: mockFetch as typeof globalThis.fetch,
        openBrowser: async () => {
          browserOpened = true;
        },
      });

      expect(result.success).toBe(true);
      expect(browserOpened).toBe(false);
    });

    it("should still check existing login before code auth", async () => {
      // Pre-save a config
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(tempDir, { recursive: true });
      await writeFile(
        join(tempDir, "config.json"),
        JSON.stringify({ token: "pk_existing" })
      );

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "ABCD-1234",
        fetch: async () => {
          throw new Error("Should not call fetch");
        },
        openBrowser: async () => {
          throw new Error("Should not open browser");
        },
      });

      expect(result.success).toBe(true);
      expect(result.alreadyLoggedIn).toBe(true);
    });

    it("should allow code login with force=true even when already logged in", async () => {
      // Pre-save a config
      const { writeFile, mkdir } = await import("node:fs/promises");
      await mkdir(tempDir, { recursive: true });
      await writeFile(
        join(tempDir, "config.json"),
        JSON.stringify({ token: "pk_old" })
      );

      const mockFetch = async () => {
        return new Response(JSON.stringify({
          api_key: "pk_new_from_code",
          email: "new@example.com",
        }), { status: 200 });
      };

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "ABCD-9999",
        force: true,
        fetch: mockFetch as typeof globalThis.fetch,
        openBrowser: async () => {
          throw new Error("Should not open browser");
        },
      });

      expect(result.success).toBe(true);
      expect(result.email).toBe("new@example.com");

      const config = JSON.parse(
        await readFile(join(tempDir, "config.json"), "utf-8")
      );
      expect(config.token).toBe("pk_new_from_code");
    });

    it("should fail when response has no api_key", async () => {
      const mockFetch = async () => {
        return new Response(JSON.stringify({
          email: "nokey@example.com",
        }), { status: 200 });
      };

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "ABCD-NOKEY",
        fetch: mockFetch as typeof globalThis.fetch,
        openBrowser: async () => {
          throw new Error("Should not open browser");
        },
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("No API key");
    });
  });

  // ---- Custom log callback ----

  describe("custom log callback", () => {
    it("should use custom log function instead of console.log", async () => {
      const logMessages: string[] = [];

      // Use a short timeout so the test doesn't hang waiting for browser callback
      const loginPromise = executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        timeoutMs: 300,
        generateNonce: () => FIXED_NONCE,
        log: (msg) => logMessages.push(msg),
        openBrowser: async (_url) => {
          // Simulate browser failure to trigger the log callback
          throw new Error("Browser not available");
        },
      });

      // Wait for timeout or result
      const result = await loginPromise;

      // The log function should have been called with the "Could not open browser" message
      const browserMsg = logMessages.find((m) => m.includes("Could not open browser"));
      expect(browserMsg).toBeDefined();
      expect(result.success).toBe(false);
    }, 2000);

    it("should not call log function for code-based login (browser flow is skipped)", async () => {
      const logMessages: string[] = [];

      const mockFetch = async () => {
        return new Response(JSON.stringify({
          api_key: "pk_log_test",
          email: "log@example.com",
        }), { status: 200 });
      };

      const result = await executeLogin({
        configDir: tempDir,
        apiUrl: "http://localhost:7020",
        code: "ABCD-9999",
        fetch: mockFetch as typeof globalThis.fetch,
        log: (msg) => logMessages.push(msg),
        openBrowser: async () => {
          throw new Error("Should not open browser");
        },
      });

      // log callback should NOT be called for code-based login (no browser flow)
      expect(logMessages).toHaveLength(0);
      expect(result.success).toBe(true);
    });
  });
});
