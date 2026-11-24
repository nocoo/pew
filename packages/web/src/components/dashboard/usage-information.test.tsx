import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@nocoo/basalt/components/tooltip";
import { getDefaultPricingMap } from "@/lib/pricing";
import { UsageInformation } from "./usage-information";

describe("compact usage disclosure", () => {
  it("renders only an accessible icon at rest, never diagnostic paragraphs", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(UsageInformation, {
          records: [
            {
              source: "hermes",
              model: "private-model",
              input_tokens: 1,
              output_tokens: 1,
              cached_input_tokens: 0,
              approximate_tokens: 1644,
            },
          ],
          pricingMap: getDefaultPricingMap(),
        }),
      ),
    );
    expect(html).toContain('aria-label="Usage information"');
    expect(html).not.toMatch(/<p[ >]|private-model|1,644|Costs are estimates|hermes/);
  });

  it("omits empty information but retains an explicitly provided page explanation", () => {
    const render = (children?: string) =>
      renderToStaticMarkup(
        createElement(
          TooltipProvider,
          null,
          createElement(UsageInformation, {
            records: [],
            pricingMap: getDefaultPricingMap(),
            children,
            label: "Overview information",
          }),
        ),
      );
    expect(render()).toBe("");
    expect(render("Period scope")).toContain('aria-label="Overview information"');
    expect(render("Period scope")).not.toContain("Period scope");
  });
});
