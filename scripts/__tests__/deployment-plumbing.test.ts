import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const revision = "3703a073693d598159e87f77f99587e586c14cfe";
const pipeline = source(".github/workflows/pipeline.yml");
const slots = source(".github/workflows/quality-slots.yml");
const compose = source("deploy/compose.yaml");

describe("Docker CD contract", () => {
  it("retains quality, API and browser lanes and adds a clean Linux image smoke", () => {
    for (const command of [
      "bun run typecheck",
      "bun run lint",
      "bun run test:coverage",
      "bun run test:e2e",
      "bun run test:e2e:ui",
    ]) {
      expect(slots).toContain(command);
    }
    const smoke = slots.split("  p1-package:\n")[1]?.split("\n  z1-gate:")[0] ?? "";
    expect(smoke).toContain('name: "P1: Package"');
    expect(smoke).toContain("docker/setup-buildx-action@37fe631027851001ddb9b187196cc803df7f5f0e");
    expect(smoke).toContain("docker/build-push-action@53b7df96c91f9c12dcc8a07bcb9ccacbed38856a");
    expect(smoke).toContain("platforms: linux/amd64");
    expect(smoke).toContain("tags: pew-ci:");
    expect(smoke).toContain("load: true");
    expect(smoke).toContain("cache-from: type=gha,scope=pew-web");
    expect(smoke).toContain("cache-to: type=gha,mode=max,scope=pew-web");
    expect(smoke).toContain("node scripts/smoke-container.mjs pew-ci:");
    expect(smoke).not.toMatch(/secrets:|build-arg|env-file/);
    expect(pipeline).toContain("uses: ./.github/workflows/quality-slots.yml");
    expect(pipeline).not.toContain("test-job.yml");
    expect(slots).not.toContain("l1-pre-commit-selftest:");
    expect(slots).not.toContain('name: "L1: Unit (Pre-commit Gate)"');
    expect(slots).not.toContain("bun run test:l1-gate");
    expect(slots).toContain(`nocoo/base-ci/.github/actions/setup-playwright@${revision}`);
    expect(slots).toContain(`nocoo/base-ci/.github/actions/z1-gate@${revision}`);
    expect(slots).toContain("core-dist");
    expect(slots).toContain("l3-integration:");
    expect(slots).toContain("l4-e2e-1:");
    expect(slots).toContain("l4-e2e-2:");
    expect(slots).toContain("p1-package:");
    expect(slots).toContain("z1-gate:");
  });

  it("uses only the pinned unified pipeline and same-run quality gate", () => {
    expect(pipeline).toContain("name: Pipeline");
    expect(pipeline).toContain(
      `uses: nocoo/base-ci/.github/workflows/deploy-docker.yml@${revision}`,
    );
    expect(pipeline).toContain("needs: [quality]");
    expect(pipeline).toContain(
      "if: (github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' && inputs.deploy == true)",
    );
    expect(pipeline).not.toContain("workflow_run:");
    expect(pipeline).not.toContain("source-run-id:");
    expect(pipeline).not.toContain("required-quality-check:");
    expect(pipeline).toContain("tailscale: true");
    expect(pipeline).toContain("environment: pew / production");
    expect(pipeline).toMatch(/TS_OAUTH_CLIENT_ID: \$\{\{ secrets\.TS_OAUTH_CLIENT_ID \}\}/);
    expect(pipeline).toMatch(/TS_AUDIENCE: \$\{\{ secrets\.TS_AUDIENCE \}\}/);
    expect(pipeline).toContain("id-token: write");
    expect(pipeline).toContain("deploy-directory: /opt/pew");
    expect(pipeline).toContain('images: \'[{"image":"ghcr.io/nocoo/pew","service":"web"}]\'');
    expect(pipeline).not.toMatch(/build-args|BUILD_ARGS|secrets: inherit|railway|lizheng|firefly/i);
    for (const variable of ["DEPLOY_PHASE", "DEPLOY_URL", "DEPLOY_ORIGIN_MARKER"]) {
      expect(pipeline).toContain(`toJSON(vars.${variable})`);
    }
    expect(pipeline).toContain("sourceSha: process.env.SOURCE_SHA");
    expect(pipeline).toContain("imageManifest: process.env.RELEASE_IMAGES");
  });

  it("preserves raw runtime values, exact Railway byte limit and loopback-only exposure", () => {
    expect(compose).toContain(`image: ghcr.io/nocoo/pew:\${IMAGE_SHA:?IMAGE_SHA is required}`);
    expect(compose).toContain("container_name: pew-app");
    expect(compose).toContain("- path: .env.runtime\n        required: true\n        format: raw");
    expect(compose).toContain(
      'environment:\n      PORT: "7020"\n      HOSTNAME: 0.0.0.0\n    ports:',
    );
    expect(compose).toContain("127.0.0.1:17020:7020");
    expect(compose).toContain("mem_limit: 8000000000\n");
    expect(compose).toContain("networks:\n  edge:\n    external: true");
    expect(compose).toContain("redirect:'error'");
    expect(compose).toContain("Host:'pew.md','X-Forwarded-Proto':'https'");
    expect(compose).not.toMatch(/NODE_OPTIONS|CF_|AUTH_|WORKER_|build:/);
  });
});
