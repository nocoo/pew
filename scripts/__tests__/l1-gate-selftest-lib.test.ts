import { describe, expect, it } from "vitest";
import { probePassed } from "../l1-gate-selftest-lib.js";

describe("l1-gate-selftest-lib", () => {
	it("probePassed distinguishes accept vs reject expectations", () => {
		expect(probePassed(false, 0, null)).toBe(true);
		expect(probePassed(true, 1, null)).toBe(true);
		expect(probePassed(true, 0, null)).toBe(false);
		expect(probePassed(false, 1, null)).toBe(false);
		expect(probePassed(true, 0, null, false)).toBe(false);
	});

	it("probePassed treats a signalled run as a rejection", () => {
		// A killed hook never reports an exit code; without this the
		// timeout-interrupt probe would pass on a signal it cannot explain.
		expect(probePassed(true, null, "SIGTERM")).toBe(true);
		expect(probePassed(false, null, "SIGTERM")).toBe(false);
	});
});
