import { describe, expect, it } from "vitest";
import { l1ProbeOk } from "./l1-probe.js";

describe("l1-probe", () => {
	it("stays covered for L1 gate self-test baseline", () => {
		expect(l1ProbeOk()).toBe(true);
	});
});
