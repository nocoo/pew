/** Pure helpers for L1 gate self-test reporting (unit-tested). */

export function parseCoverageText(text: string): {
	statements: number;
	branches: number;
	functions: number;
	lines: number;
} | null {
	const block = text.match(
		/All files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)/,
	);
	if (!block) {
		return null;
	}
	return {
		statements: Number(block[1]),
		branches: Number(block[2]),
		functions: Number(block[3]),
		lines: Number(block[4]),
	};
}

export function probePassed(
	expectReject: boolean,
	status: number | null,
	signal: NodeJS.Signals | null,
	extraOk = true,
): boolean {
	const rejected = status !== 0 || signal !== null;
	return expectReject ? rejected && extraOk : status === 0 && signal === null;
}
