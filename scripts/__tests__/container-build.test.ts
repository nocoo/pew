import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const dockerfile = source("Dockerfile");

describe("production container", () => {
  it("builds without application credentials or test switches", () => {
    expect([...dockerfile.matchAll(/^ARG (\w+)/gm)].map((match) => match[1])).toEqual([
      "NODE_VERSION",
    ]);
    expect(dockerfile).not.toMatch(/CF_|AUTH_|WORKER_|E2E_|TOKEN|SECRET|--mount=type=secret/);
    expect(dockerfile).toContain("RUN bun install --frozen-lockfile");
    expect(dockerfile).toContain("COPY --from=oven/bun:1.4.0");
    expect(dockerfile).toContain("node ./node_modules/.bin/next build");
  });

  it("preserves standalone assets and SWC helpers with writable non-root caches", () => {
    expect(dockerfile).toContain("scripts/fix-standalone-swc-helpers.ts --required");
    for (const [from, to] of [
      [".next/standalone", "./"],
      [".next/static", "./packages/web/.next/static"],
      ["public", "./packages/web/public"],
    ]) {
      expect(dockerfile).toContain(
        `COPY --from=builder --chown=node:node /app/packages/web/${from} ${to}`,
      );
    }
    expect(dockerfile).toContain("USER node");
    expect(dockerfile).toMatch(/USER node\s+RUN node -e .*sharp.*\.png\(\)\.toBuffer\(\)/);
    expect(dockerfile).toContain('CMD ["node", "packages/web/server.js"]');
    expect(dockerfile).toContain("ENV NODE_ENV=production");
    expect(dockerfile).toContain("ENV PORT=7020");
  });

  it("excludes credentials and generated state at every workspace depth", () => {
    const rules = source(".dockerignore").trim().split("\n");
    expect(rules[0]).toBe("**");
    expect(rules).toEqual(
      expect.arrayContaining([
        "!package.json",
        "!bun.lock",
        "!tsconfig.json",
        "!packages/",
        "!packages/**",
        "!scripts/",
        "!scripts/fix-standalone-swc-helpers.ts",
        "**/.env*",
        "**/.dev.vars*",
        "**/*.pem",
        "**/*.key",
        "**/node_modules",
        "**/.next*",
        "**/dist",
        "**/.wrangler",
      ]),
    );
    expect(rules.slice(rules.indexOf("**/.env*") + 1).some((rule) => rule.startsWith("!"))).toBe(
      false,
    );
  });
});
