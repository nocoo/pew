import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PricingInformation } from "../pricing-information";
import type { DynamicPricingMetaDto } from "@/lib/rpc-types";

vi.mock("@/components/info-tooltip", () => ({ InfoTooltip: ({ children }: { children: React.ReactNode }) => createElement("aside", null, children) }));

const meta: DynamicPricingMetaDto = {
  lastSyncedAt: "2026-10-04T00:00:00Z", modelCount: 99, baselineCount: 50, openRouterCount: 30, modelsDevCount: 19, lastErrors: null,
};

describe("public model price information", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-04T06:00:00Z")); });
  afterEach(() => vi.useRealTimers());
  it.each([undefined, meta, { ...meta, lastSyncedAt: "not-a-date" }])("never exposes backend catalog state: %j", (value) => {
    const html = renderToStaticMarkup(createElement(PricingInformation, { meta: value, servedFrom: "kv" }));
    expect(html).toContain("USD per million tokens");
    expect(html).toContain("Actual bills may differ");
    expect(html).not.toMatch(/baseline|worker-read|not-a-date|models.dev|99/);
  });
  it.each([
    { meta, servedFrom: "baseline" as const },
    { meta: { ...meta, lastSyncedAt: "2026-09-01" }, servedFrom: "kv" as const },
    { meta: { ...meta, lastErrors: [{ source: "kv" as const, message: "PRIVATE_BACKEND_ERROR", at: "2026-10-04" }] }, servedFrom: "kv" as const },
  ])("discloses stale prices without dumping technical errors", (props) => {
    const html = renderToStaticMarkup(createElement(PricingInformation, props));
    expect(html).toContain("Some prices may be out of date");
    expect(html).not.toContain("PRIVATE_BACKEND_ERROR");
  });
});
