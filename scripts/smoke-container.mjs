import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export function smokeContainer(image, run = execFileSync) {
  const name = `pew-smoke-${randomUUID()}`;
  try {
    run(
      "docker",
      [
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--pull",
        "never",
        "--platform",
        "linux/amd64",
        "--entrypoint",
        "node",
        "--mount",
        `type=bind,source=${fileURLToPath(import.meta.url)},target=/tmp/pew-smoke.mjs,readonly`,
        "--env",
        "AUTH_SECRET=pew-container-smoke-not-a-production-secret",
        "--env",
        "NEXTAUTH_URL=https://pew.md",
        "--env",
        "CF_ACCOUNT_ID=smoke",
        "--env",
        "CF_D1_DATABASE_ID=smoke",
        "--env",
        "CF_D1_API_TOKEN=smoke",
        "--env",
        "WORKER_READ_URL=http://127.0.0.1:9",
        "--env",
        "WORKER_READ_SECRET=smoke",
        image,
        "/tmp/pew-smoke.mjs",
        "--inside",
      ],
      { timeout: 120_000, stdio: "pipe" },
    );
  } catch {
    throw new Error("Container smoke failed");
  } finally {
    try {
      run("docker", ["rm", "--force", name], { timeout: 10_000, stdio: "pipe" });
    } catch {
      // --rm already removes the container after a normal exit.
    }
  }
}

export async function verifyStartup({ expectedVersion, fetchImpl = fetch, sleep = delay }) {
  const request = (path, options = {}) =>
    fetchImpl(new URL(path, "http://127.0.0.1:7020"), {
      redirect: "error",
      signal: AbortSignal.timeout(2_000),
      headers: { Host: "pew.md", "X-Forwarded-Proto": "https" },
      ...options,
    });
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await request("/api/live");
      const live = await response.json();
      if (
        response.status === 503 &&
        response.headers.get("cache-control") === "no-store" &&
        live.status === "error" &&
        live.component === "dashboard" &&
        live.version === expectedVersion &&
        live.database?.connected === false
      ) {
        ready = true;
        break;
      }
    } catch {
      // The process may not have bound its listener yet.
    }
    if (attempt < 29) await sleep(1_000);
  }
  if (!ready) throw new Error("Startup health check failed");
  const logo = await request("/logo-80.png");
  assert(
    logo.status === 200 && logo.headers.get("content-type")?.includes("image/png"),
    "Static asset check failed",
  );
  assert((await logo.arrayBuffer()).byteLength > 0, "Static asset is empty");
  assert(
    (await request("/api/ingest", { method: "POST", body: "" })).status === 401,
    "Unauthenticated ingest was not denied",
  );
}

async function inside() {
  assert(process.platform === "linux" && process.arch === "x64", "Expected Linux amd64");
  assert(process.getuid() !== 0, "Expected non-root runtime");
  assert(!process.env.NODE_OPTIONS, "Unexpected NODE_OPTIONS");
  const require = createRequire("/app/packages/web/package.json");
  const sharp = createRequire(require.resolve("next"))("sharp");
  const png = await sharp({ create: { width: 1, height: 1, channels: 4, background: "#fff" } })
    .png()
    .toBuffer();
  assert(png.length > 0, "Native Sharp failed");
  const expectedVersion = JSON.parse(
    readFileSync("/app/packages/web/package.json", "utf8"),
  ).version;
  const server = spawn(process.execPath, ["packages/web/server.js"], {
    cwd: "/app",
    stdio: "ignore",
  });
  server.on("error", () => {
    server.kill();
  });
  try {
    await verifyStartup({ expectedVersion });
  } finally {
    server.kill();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--inside") await inside();
    else {
      assert(process.argv[2], "An existing local image is required");
      smokeContainer(process.argv[2]);
    }
    console.log("Pew Linux native/startup smoke passed (isolated, no production credentials)");
  } catch {
    console.error("Pew container smoke failed");
    process.exitCode = 1;
  }
}
