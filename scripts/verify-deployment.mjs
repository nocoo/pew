import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

function packageVersion() {
  try {
    return JSON.parse(
      readFileSync(new URL("../packages/web/package.json", import.meta.url), "utf8"),
    ).version;
  } catch {
    throw new Error("cannot read expected package version");
  }
}

function validateRelease(sourceSha, imageManifest) {
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error("SOURCE_SHA must be a full commit SHA");
  let releases;
  try {
    releases = JSON.parse(imageManifest);
  } catch {
    throw new Error("RELEASE_IMAGES must be valid JSON");
  }
  if (!Array.isArray(releases) || releases.length !== 1)
    throw new Error("expected exactly one deployed image");
  const [release] = releases;
  if (
    release?.service !== "web" ||
    release.image !== "ghcr.io/nocoo/pew" ||
    release.sourceSha !== sourceSha ||
    !/^sha256:[a-f0-9]{64}$/.test(release.digest ?? "")
  ) {
    throw new Error("release manifest does not prove the Pew image digest and source revision");
  }
  return release;
}

function validateTarget(target) {
  if (!target) throw new Error("DEPLOY_URL is required");
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error("DEPLOY_URL must be an absolute URL");
  }
  if (url.href !== "https://pew.md/" || !["https://pew.md", "https://pew.md/"].includes(target)) {
    throw new Error("DEPLOY_URL must be the canonical https://pew.md origin without a path");
  }
  return url;
}

async function fetchResponse(fetchImpl, url) {
  try {
    return await fetchImpl(url, { signal: AbortSignal.timeout(10_000), redirect: "error" });
  } catch {
    throw new Error(`request to ${url.pathname} failed`);
  }
}

async function verifyProduction({ target, originMarker, expectedVersion, fetchImpl, sleep }) {
  if (originMarker !== "jp2")
    throw new Error("production verification requires DEPLOY_ORIGIN_MARKER=jp2");
  const origin = validateTarget(target);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const liveResponse = await fetchResponse(fetchImpl, new URL("/api/live", origin));
    const live = await liveResponse.json().catch(() => null);
    if (
      liveResponse.status === 200 &&
      live?.status === "ok" &&
      live.component === "dashboard" &&
      live.version === expectedVersion &&
      live.database?.connected === true &&
      liveResponse.headers.get("x-pew-origin") === "jp2" &&
      liveResponse.headers.get("cache-control") === "no-store"
    ) {
      return `Production origin verified: jp2, Pew ${expectedVersion}, database connected`;
    }
    if (attempt < 4) await sleep(5_000);
  }
  throw new Error(
    "production /api/live did not prove jp2 origin, expected version, and database health",
  );
}

export async function verifyDeployment({
  phase,
  target,
  originMarker,
  sourceSha,
  imageManifest,
  fetchImpl = fetch,
  sleep = delay,
}) {
  const release = validateRelease(sourceSha, imageManifest);
  const expectedVersion = packageVersion();
  if (phase === "precutover") {
    return `Private acceptance only: ${release.image}@${release.digest} from ${sourceSha}; public origin was not contacted`;
  }
  if (phase === "production") {
    return verifyProduction({ target, originMarker, expectedVersion, fetchImpl, sleep });
  }
  throw new Error("DEPLOY_PHASE must be explicitly set to precutover or production");
}

async function main() {
  const [phase, target, originMarker] = process.argv.slice(2);
  const message = await verifyDeployment({
    phase,
    target,
    originMarker,
    sourceSha: process.env.SOURCE_SHA ?? "",
    imageManifest: process.env.RELEASE_IMAGES ?? "",
  });
  console.log(message);
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  main().catch((error) => {
    console.error(`Deployment verification failed: ${error.message}`);
    process.exitCode = 1;
  });
}
