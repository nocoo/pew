import { defineConfig } from "@playwright/test";

const E2E_UI_PORT = process.env.E2E_UI_PORT || "27020";

export default defineConfig({
  testDir: ".",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 1,
  use: {
    baseURL: `http://localhost:${E2E_UI_PORT}`,
    headless: true,
    navigationTimeout: 30_000,
  },
  // No webServer — scripts/run-e2e-ui.ts manages the dev server lifecycle.
});
