import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { verifyDeployment } from "../verify-deployment.mjs";

const sourceSha = "a".repeat(40);
const release = {
  service: "web",
  image: "ghcr.io/nocoo/pew",
  digest: `sha256:${"b".repeat(64)}`,
  sourceSha,
};
const expectedVersion = JSON.parse(
  readFileSync(new URL("../../packages/web/package.json", import.meta.url), "utf8"),
).version;

function options(overrides: Record<string, unknown> = {}) {
  return { phase: "precutover", sourceSha, imageManifest: JSON.stringify([release]), ...overrides };
}

function production(overrides: Record<string, unknown> = {}) {
  return options({
    phase: "production",
    target: "https://pew.md",
    originMarker: "jp2",
    ...overrides,
  });
}

const validBody = {
  status: "ok",
  component: "dashboard",
  version: expectedVersion,
  database: { connected: true },
};
const validHeaders = { "x-pew-origin": "jp2", "Cache-Control": "no-store" };

describe("deployment verification", () => {
  it("precutover never contacts public Railway, regardless of the configured URL", async () => {
    for (const target of [undefined, "https://pew.md", "https://old.up.railway.app", "not a URL"]) {
      const fetchImpl = vi.fn();
      await expect(verifyDeployment(options({ target, fetchImpl }))).resolves.toContain(
        "public origin was not contacted",
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it.each([undefined, "", "Production", "preview", "precutover "])(
    "fails closed for phase %s before any fetch",
    async (phase) => {
      const fetchImpl = vi.fn();
      await expect(verifyDeployment(options({ phase, fetchImpl }))).rejects.toThrow("DEPLOY_PHASE");
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("rejects missing or mismatched immutable release proof without fetching", async () => {
    const fetchImpl = vi.fn();
    for (const override of [
      { sourceSha: "main" },
      { imageManifest: "not-json" },
      { imageManifest: "null" },
      { imageManifest: "{}" },
      { imageManifest: "[]" },
      { imageManifest: JSON.stringify([release, release]) },
      ...[
        null,
        { ...release, image: "ghcr.io/nocoo/other" },
        { ...release, service: "worker" },
        { ...release, digest: "latest" },
        { ...release, sourceSha: "c".repeat(40) },
      ].map((entry) => ({ imageManifest: JSON.stringify([entry]) })),
    ]) {
      await expect(verifyDeployment(production({ ...override, fetchImpl }))).rejects.toThrow();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("production requires the explicit jp2 marker and only the canonical HTTPS origin", async () => {
    const fetchImpl = vi.fn();
    await expect(
      verifyDeployment(production({ originMarker: undefined, fetchImpl })),
    ).rejects.toThrow("DEPLOY_ORIGIN_MARKER=jp2");
    for (const target of [
      undefined,
      "",
      "not a URL",
      "http://pew.md",
      "https://other.example",
      "https://pew.md/old",
      "https://pew.md?x",
      "https://pew.md#x",
      "https://user@pew.md",
      "https://pew.md:443",
      "https://PEW.md",
      "https://old.up.railway.app",
    ]) {
      await expect(verifyDeployment(production({ target, fetchImpl }))).rejects.toThrow(
        "DEPLOY_URL",
      );
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects and sanitizes transport errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("sensitive response or env"));
    const result = verifyDeployment(production({ fetchImpl }));
    await expect(result).rejects.toThrow("request to /api/live failed");
    await expect(result).rejects.not.toThrow("sensitive");
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL("https://pew.md/api/live"),
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it.each(["https://pew.md", "https://pew.md/"])(
    "accepts %s only with exact health and origin identity",
    async (target) => {
      const fetchImpl = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify(validBody), { headers: validHeaders })),
        );
      await expect(verifyDeployment(production({ target, fetchImpl }))).resolves.toContain(
        `Pew ${expectedVersion}`,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it("retries stale health without accepting a wrong version, component, D1 or origin", async () => {
    for (const variant of [
      { body: { ...validBody, version: "0.0.0" } },
      { body: { ...validBody, database: { connected: false } } },
      { body: { ...validBody, component: "other" } },
      { body: { ...validBody, status: "error" } },
      { body: null },
      { body: "invalid-json" },
      { headers: { ...validHeaders, "x-pew-origin": "railway" } },
      { headers: { "Cache-Control": "no-store" } },
      { headers: { ...validHeaders, "Cache-Control": "public, max-age=0" } },
      { status: 503 },
      { status: 302 },
    ]) {
      const fetchImpl = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            new Response(
              "body" in variant ? JSON.stringify(variant.body) : JSON.stringify(validBody),
              { status: variant.status ?? 200, headers: variant.headers ?? validHeaders },
            ),
          ),
        );
      const sleep = vi.fn();
      await expect(verifyDeployment(production({ fetchImpl, sleep }))).rejects.toThrow(
        "did not prove jp2 origin",
      );
      expect(fetchImpl).toHaveBeenCalledTimes(5);
      expect(sleep).toHaveBeenCalledTimes(4);
    }
  });

  it("accepts health recovery within the bounded retry window", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("not-json", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(validBody), { headers: validHeaders }));
    const sleep = vi.fn();
    await expect(verifyDeployment(production({ fetchImpl, sleep }))).resolves.toContain(
      "database connected",
    );
    expect(sleep).toHaveBeenCalledExactlyOnceWith(5_000);
  });
});
