import { describe, expect, it, vi } from "vitest";
import { smokeContainer, verifyStartup } from "../smoke-container.mjs";

const version = "3.4.0";
const unhealthy = {
  status: "error",
  component: "dashboard",
  version,
  database: { connected: false },
};

function fixture(overrides: Record<string, unknown> = {}) {
  const fetchImpl = vi.fn().mockImplementation((url: URL) => {
    if (url.pathname === "/api/live")
      return Promise.resolve(
        new Response(JSON.stringify(unhealthy), {
          status: 503,
          headers: { "Cache-Control": "no-store" },
        }),
      );
    if (url.pathname === "/logo-80.png")
      return Promise.resolve(new Response("png", { headers: { "Content-Type": "image/png" } }));
    return Promise.resolve(new Response("{}", { status: 401 }));
  });
  return { expectedVersion: version, fetchImpl, sleep: vi.fn(), ...overrides };
}

function assertIsolatedArgs(args: string[]) {
  for (const arg of args) {
    expect(arg).not.toMatch(/^(?:--env-file|--publish|-p)(?:=|$)/);
    expect(arg).not.toMatch(/^(?:(?:--env|-e)=)?NODE_OPTIONS(?:=|$)/);
  }
}

describe("clean Linux image smoke", () => {
  it("tests native/startup without any network, published port or production secrets", () => {
    const run = vi.fn();
    smokeContainer("pew-precutover:local", run);
    const args = run.mock.calls[0][1] as string[];
    expect(args).toEqual(
      expect.arrayContaining([
        "run",
        "--rm",
        "--network",
        "none",
        "--pull",
        "never",
        "--platform",
        "linux/amd64",
        "--entrypoint",
        "node",
        "--inside",
      ]),
    );
    expect(args).toContain("AUTH_SECRET=pew-container-smoke-not-a-production-secret");
    assertIsolatedArgs(args);
    expect(run.mock.calls[0][2]).toEqual(
      expect.objectContaining({ timeout: 120_000, stdio: "pipe" }),
    );
    expect(run.mock.calls[1][1]).toEqual(["rm", "--force", args[args.indexOf("--name") + 1]]);
  });

  it.each([
    ["--env-file", ".env.runtime"],
    ["--env-file=.env.runtime"],
    ["--publish", "17020:7020"],
    ["--publish=17020:7020"],
    ["-p", "17020:7020"],
    ["-p=17020:7020"],
    ["NODE_OPTIONS"],
    ["NODE_OPTIONS=--max-old-space-size=8192"],
    ["--env=NODE_OPTIONS=--max-old-space-size=8192"],
    ["-e=NODE_OPTIONS=--max-old-space-size=8192"],
  ])("rejects an isolated forbidden argument mutation: %s", (...mutation) => {
    const run = vi.fn();
    smokeContainer("pew-precutover:local", run);
    const args = run.mock.calls[0][1] as string[];
    expect(() => assertIsolatedArgs(args)).not.toThrow();
    expect(() => assertIsolatedArgs([...args, ...mutation])).toThrow();
  });

  it("cleans up its own container on failure and reports no Docker output", () => {
    const run = vi.fn().mockImplementationOnce(() => {
      throw new Error("sensitive fixture body or env");
    });
    expect(() => smokeContainer("pew-precutover:local", run)).toThrow("Container smoke failed");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("accepts fail-closed D1 health without credentials and unauthenticated ingest denial", async () => {
    const options = fixture();
    await expect(verifyStartup(options)).resolves.toBeUndefined();
    expect(options.fetchImpl).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:7020/api/live"),
      expect.objectContaining({
        redirect: "error",
        headers: { Host: "pew.md", "X-Forwarded-Proto": "https" },
      }),
    );
    expect(options.fetchImpl).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:7020/api/ingest"),
      expect.objectContaining({ method: "POST", body: "" }),
    );
  });

  it("bounds startup retries, rejects redirects, wrong identities, connected D1 and stale versions", async () => {
    for (const body of [
      { ...unhealthy, version: "0.0.0" },
      { ...unhealthy, component: "other" },
      { ...unhealthy, database: { connected: true } },
    ]) {
      const options = fixture({
        fetchImpl: vi.fn().mockImplementation(() =>
          Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 503,
              headers: { "Cache-Control": "no-store" },
            }),
          ),
        ),
      });
      await expect(verifyStartup(options)).rejects.toThrow("Startup health check failed");
      expect(options.fetchImpl).toHaveBeenCalledTimes(30);
      expect(options.sleep).toHaveBeenCalledTimes(29);
    }
    for (const fetchImpl of [
      vi.fn().mockRejectedValue(new Error("redirect")),
      vi.fn().mockImplementation(() => Promise.resolve(new Response("invalid-json"))),
    ]) {
      await expect(verifyStartup(fixture({ fetchImpl }))).rejects.toThrow(
        "Startup health check failed",
      );
    }
  });

  it.each(["/logo-80.png", "/api/ingest"])("rejects a broken %s", async (broken) => {
    const options = fixture();
    const normal = options.fetchImpl.getMockImplementation()!;
    options.fetchImpl.mockImplementation((url: URL) =>
      url.pathname === broken
        ? Promise.resolve(new Response("unexpected", { status: 200 }))
        : normal(url),
    );
    await expect(verifyStartup(options)).rejects.toThrow();
  });
});
