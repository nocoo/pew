import { defineConfig } from "vitest/config";

/**
 * CLI E2E test config.
 * Run with: bun run vitest run --config vitest.e2e-cli.config.ts
 */
export default defineConfig({
  test: {
    globals: true,
    include: ["packages/cli/src/__tests__/e2e/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
