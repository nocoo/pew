import { describe, expect, it } from "vitest";
import { parseCoverageText, probePassed } from "../l1-gate-selftest-lib.js";

describe("l1-gate-selftest-lib", () => {
	it("parseCoverageText reads vitest v8 table", () => {
		const sample = `
 % Coverage report from v8
-------------------|---------|----------|---------|---------|
All files          |   98.15 |    95.38 |   98.39 |   99.09 |
`;
		expect(parseCoverageText(sample)).toEqual({
			statements: 98.15,
			branches: 95.38,
			functions: 98.39,
			lines: 99.09,
		});
	});

	it("probePassed distinguishes accept vs reject expectations", () => {
		expect(probePassed(false, 0, null)).toBe(true);
		expect(probePassed(true, 1, null)).toBe(true);
		expect(probePassed(true, 0, null)).toBe(false);
		expect(probePassed(false, 1, null)).toBe(false);
		expect(probePassed(true, 0, null, false)).toBe(false);
	});
});
