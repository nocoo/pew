/** Pure helpers for the pre-commit static-gate self-test (unit-tested). */

export function probePassed(
	expectReject: boolean,
	status: number | null,
	signal: NodeJS.Signals | null,
	extraOk = true,
): boolean {
	const rejected = status !== 0 || signal !== null;
	return expectReject ? rejected && extraOk : status === 0 && signal === null;
}
