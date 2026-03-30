import { defineConfig } from "@playwright/test";

const E2E_UI_PORT = process.env.E2E_UI_PORT || "27020";

export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: `http://localhost:${E2E_UI_PORT}`,
    headless: true,
  },
  // No webServer — scripts/run-e2e-ui.ts manages the dev server lifecycle.
});
