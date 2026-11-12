import { describe, it, expect } from "vitest";
import { isE2EMode } from "../lib/e2e-mode";

/**
 * The single E2E bypass gate. Every consumer (API auth, admin bypass, invite
 * gate, page proxy) calls this, so these are the only places the four-variable
 * truth table needs to be asserted.
 */
describe("isE2EMode", () => {
  const base = { E2E_SKIP_AUTH: "true", RESOURCE_ENV: "test", PEW_TEST_RUN_ID: "owned-run" };

  it("is true only when all four conditions hold", () => {
    expect(isE2EMode(base)).toBe(true);
  });

  it("is false when E2E_SKIP_AUTH is not exactly 'true'", () => {
    expect(isE2EMode({ ...base, E2E_SKIP_AUTH: "false" })).toBe(false);
    expect(isE2EMode({ ...base, E2E_SKIP_AUTH: "1" })).toBe(false);
    expect(isE2EMode({ ...base, E2E_SKIP_AUTH: undefined })).toBe(false);
  });

  it("is false when RESOURCE_ENV is not 'test' (no isolated runner environment)", () => {
    expect(isE2EMode({ ...base, RESOURCE_ENV: "production" })).toBe(false);
    expect(isE2EMode({ ...base, RESOURCE_ENV: undefined })).toBe(false);
  });

  it("is false when PEW_TEST_RUN_ID is absent or empty", () => {
    expect(isE2EMode({ ...base, PEW_TEST_RUN_ID: undefined })).toBe(false);
    expect(isE2EMode({ ...base, PEW_TEST_RUN_ID: "" })).toBe(false);
  });

  it("is false on Railway regardless of the other two (deployed-path veto)", () => {
    expect(isE2EMode({ ...base, RAILWAY_ENVIRONMENT: "production" })).toBe(false);
    expect(isE2EMode({ ...base, E2E_ADMIN_BYPASS: "true", RAILWAY_ENVIRONMENT: "production" })).toBe(false);
  });

  it("does not depend on NODE_ENV, so the L3 production build keeps the bypass", () => {
    // `next build` prerenders only under NODE_ENV=production; a gate keyed on
    // the framework's build mode made admin pages redirect to the landing page
    // in the production-served lane.
    expect(isE2EMode({ ...base, NODE_ENV: "production" })).toBe(true);
  });
});
