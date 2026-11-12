import { describe, expect, it } from "vitest";
import { isRepresentableEpochMs, MAX_EPOCH_MS } from "../utils/time.js";

describe("MAX_EPOCH_MS", () => {
  it("is the last instant the ingest contract accepts (9999-12-31T23:59:59.999Z)", () => {
    expect(MAX_EPOCH_MS).toBe(253_402_300_799_999);
    expect(new Date(MAX_EPOCH_MS).toISOString()).toBe("9999-12-31T23:59:59.999Z");
  });

  it("rejects instants past the 4-digit-year window a representable Date allows", () => {
    // ECMAScript Date formats 5e15 as `+160413-…Z` without throwing, and the
    // server's ISO regex accepts only a 4-digit year, so a value like this
    // would 400 the upload batch. Bound the guard to the contract, not to what
    // Date can hold.
    expect(isRepresentableEpochMs(5e15)).toBe(false);
    expect(isRepresentableEpochMs(8_640_000_000_000_000)).toBe(false);
    expect(isRepresentableEpochMs(MAX_EPOCH_MS)).toBe(true);
    expect(isRepresentableEpochMs(MAX_EPOCH_MS + 1)).toBe(false);
  });
});
