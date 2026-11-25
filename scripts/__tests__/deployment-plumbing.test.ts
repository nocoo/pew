import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const revision = "bfaac83b5a4d5c7ed26320bb5b09f3ca0a01932c";
const ci = source(".github/workflows/ci.yml");
const slots = source(".github/workflows/quality-slots.yml");
const release = source(".github/workflows/release.yml");
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
    expect(smoke).toContain("docker build --platform linux/amd64 --tag pew-ci:");
    expect(smoke).toContain("node scripts/smoke-container.mjs pew-ci:");
    expect(smoke).not.toMatch(/secrets:|build-arg|env-file/);
    expect(ci).toContain("uses: ./.github/workflows/quality-slots.yml");
    expect(ci).not.toContain("test-job.yml");
    expect(slots).not.toContain("l1-pre-commit-selftest:");
    expect(slots).not.toContain('name: "L1: Unit (Pre-commit Gate)"');
    expect(slots).not.toContain("bun run test:l1-gate");
    expect(slots).toContain(`nocoo/base-ci/.github/actions/setup-playwright@${revision}`);
    expect(slots).toContain(`nocoo/base-ci/.github/actions/z1-gate@${revision}`);
    expect(slots).toContain("core-dist");
    expect(slots).toContain("needs: [b1-build]");
    expect(slots).toContain("l3-integration:");
    expect(slots).toContain("l4-e2e:");
    expect(slots).toContain("p1-package:");
    expect(slots).toContain("z1-gate:");
  });

  it("uses only the pinned existing release chain and exact CI provenance", () => {
    expect(release).toContain(
      `uses: nocoo/base-ci/.github/workflows/deploy-docker.yml@${revision}`,
    );
    expect(release).toContain("workflow_run:");
    expect(release).toContain("- CI");
    expect(release).toContain("github.event.workflow_run.conclusion == 'success'");
    expect(release).toContain("github.event.workflow_run.head_branch == 'main'");
    expect(release).toContain(
      `source-run-id: \${{ github.event_name == 'workflow_run' && format('{0}', github.event.workflow_run.id) || inputs.ci-run-id }}`,
    );
    expect(release).toContain("tailscale: true");
    expect(release).toContain("environment: pew / production");
    expect(release).toMatch(/TS_OAUTH_CLIENT_ID: \$\{\{ secrets\.TS_OAUTH_CLIENT_ID \}\}/);
    expect(release).toMatch(/TS_AUDIENCE: \$\{\{ secrets\.TS_AUDIENCE \}\}/);
    expect(release).toContain("id-token: write");
    expect(release).toContain("deploy-directory: /opt/pew");
    expect(release).toContain('images: \'[{"image":"ghcr.io/nocoo/pew","service":"web"}]\'');
    expect(release).not.toMatch(/build-args|BUILD_ARGS|secrets: inherit|railway|lizheng|firefly/i);
    for (const variable of ["DEPLOY_PHASE", "DEPLOY_URL", "DEPLOY_ORIGIN_MARKER"]) {
      expect(release).toContain(`toJSON(vars.${variable})`);
    }
    expect(release).toContain("sourceSha: process.env.SOURCE_SHA");
    expect(release).toContain("imageManifest: process.env.RELEASE_IMAGES");
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
