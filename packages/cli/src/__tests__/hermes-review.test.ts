import { describe, expect, it } from "vitest";
import { parseHermesReviewLines } from "../parsers/hermes-review.js";

const call = "2026-09-07 00:01:00,000 INFO [synthetic-session] agent.conversation_loop: API call #1: model=test-model provider=openai in=100 out=10 total=110 latency=1.0s";
const done = "2026-09-07 00:02:00,000 INFO [synthetic-session] agent.background_review: Background review complete: thread=bg-review calls=1 in=100 out=10 cache_read=0 result=none";

describe("Hermes numeric review log parser", () => {
  it("converts a known local timezone, hashes fallback identities and ignores private text", () => {
    const result = parseHermesReviewLines(["PRIVATE_FIXTURE_BODY", call, done], "default", 480);
    expect(result).toMatchObject([{ timestamp: "2026-09-06T16:01:00.000Z", tokens: { inputTokens: 100, outputTokens: 10 } }]);
    expect(result[0].eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain("synthetic-session");
    expect(parseHermesReviewLines([call, done], "default")).toHaveLength(1);
  });

  it.each([
    call.replace("in=100", "in=?"), call.replace("total=110", "total=111"),
    `${call} cache=200/100 (200%)`, call.replace("in=100", "in=9999999999999999999999"),
    call.replace("2026-09-07", "2026-99-99"), call.replace("agent.conversation_loop", "private.logger"),
  ])("ignores unknown, malformed and inconsistent usage rather than guessing (#%#)", (bad) => {
    expect(parseHermesReviewLines([bad, done], "default", 480)).toEqual([]);
  });

  it("does not merge different models or treat a completion marker as usage by itself", () => {
    const second = call.replace("#1", "#2").replace("model=test-model", "model=other-model");
    const completion = done.replace("calls=1 in=100 out=10", "calls=2 in=200 out=20");
    expect(parseHermesReviewLines([call, second, completion], "default", 480)).toEqual([]);
    expect(parseHermesReviewLines([done, done.replace("calls=1", "calls=0"), done.replace("calls=1", "calls=1001")], "default", 480)).toEqual([]);
  });

  it("bounds ambiguous counter matching and leaves it to the cumulative ledger", () => {
    const repeated = Array.from({ length: 20 }, (_, i) => [0, 1].map((j) =>
      call.replace("#1", `#${i + 1}`).replace("in=100 out=10 total=110", "in=1 out=1 total=2") + ` id=synthetic-${i}-${j}`)).flat();
    const completion = done.replace("calls=1 in=100 out=10", "calls=20 in=21 out=20");
    expect(parseHermesReviewLines([...repeated, completion], "default", 480)).toEqual([]);
  });

  it("bounds candidate inspections as well as recursive states before declaring a unique match", () => {
    const sequence = Array.from({ length: 30 }, (_, i) => call.replace("#1", `#${i + 1}`) + ` id=sequence-${i}`);
    const unrelated = Array.from({ length: 970 }, (_, i) => call.replace("#1", "#999") + ` id=unrelated-${i}`);
    const completion = done.replace("calls=1 in=100 out=10", "calls=30 in=3000 out=300");
    // There is one numeric match, but proving uniqueness scans the unrelated
    // tail at every depth. Once the work budget is spent, retain coarse DB usage.
    expect(parseHermesReviewLines([...sequence, ...unrelated, completion], "default", 480).length).toBe(0);
  });
});
