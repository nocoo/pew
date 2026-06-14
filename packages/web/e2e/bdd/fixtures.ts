import { test as base, expect, type Page } from "@playwright/test";

export type DataGateResult = { skip: boolean; reason: string };

export function emptyDataGate(count: number, what: string): DataGateResult {
  return count === 0
    ? { skip: true, reason: `Test DB has no ${what}; seed required.` }
    : { skip: false, reason: "" };
}

export async function gotoAdmin(page: Page, path = ""): Promise<void> {
  await page.goto(`/admin${path ? `/${path}` : ""}`);
  await expect(page.locator("main")).toBeVisible();
}

export { base as test, expect };
