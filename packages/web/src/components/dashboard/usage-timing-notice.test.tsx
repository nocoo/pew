import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UsageTimingNotice } from "./usage-timing-notice";

describe("usage timing disclosure", () => {
  it("leaves old responses and exact-only usage unchanged", () => {
    for (const records of [undefined, [], [{}], [{ approximate_tokens: 0 }]]) {
      expect(renderToStaticMarkup(createElement(UsageTimingNotice, { records }))).toBe("");
    }
  });

  it("discloses the amount with coarse timing beside the time charts", () => {
    const html = renderToStaticMarkup(createElement(UsageTimingNotice, {
      records: [{ approximate_tokens: 1000 }, { approximate_tokens: 234 }, {}],
    }));
    expect(html).toContain("1,234 tokens have approximate timing");
    expect(html).toContain("session start or the end of an observed interval");
    expect(html).not.toContain("exact call times");
  });
});
