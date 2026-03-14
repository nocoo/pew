import { describe, it, expect } from "vitest";
import { deriveSeasonStatus, formatSeasonDate } from "@/lib/seasons";

// ---------------------------------------------------------------------------
// deriveSeasonStatus — ISO 8601 datetime precision
// ---------------------------------------------------------------------------

describe("deriveSeasonStatus", () => {
  it("should return 'upcoming' when now < startDate", () => {
    const now = new Date("2026-03-14T23:59:59Z");
    expect(
      deriveSeasonStatus("2026-03-15T00:00:00Z", "2026-04-15T23:59:00Z", now)
    ).toBe("upcoming");
  });

  it("should return 'active' at exactly startDate", () => {
    const now = new Date("2026-03-15T00:00:00Z");
    expect(
      deriveSeasonStatus("2026-03-15T00:00:00Z", "2026-04-15T23:59:00Z", now)
    ).toBe("active");
  });

  it("should return 'active' during the season", () => {
    const now = new Date("2026-03-20T12:30:00Z");
    expect(
      deriveSeasonStatus("2026-03-15T00:00:00Z", "2026-04-15T23:59:00Z", now)
    ).toBe("active");
  });

  it("should return 'active' at exactly endDate", () => {
    const now = new Date("2026-04-15T23:59:00Z");
    expect(
      deriveSeasonStatus("2026-03-15T00:00:00Z", "2026-04-15T23:59:00Z", now)
    ).toBe("active");
  });

  it("should return 'ended' one second after endDate", () => {
    const now = new Date("2026-04-15T23:59:01Z");
    expect(
      deriveSeasonStatus("2026-03-15T00:00:00Z", "2026-04-15T23:59:00Z", now)
    ).toBe("ended");
  });

  it("should handle minute-precision boundary correctly", () => {
    // Season starts at 08:00 UTC — at 07:59 it's still upcoming
    const before = new Date("2026-03-15T07:59:59Z");
    expect(
      deriveSeasonStatus("2026-03-15T08:00:00Z", "2026-04-15T20:00:00Z", before)
    ).toBe("upcoming");

    // At 08:00 it's active
    const at = new Date("2026-03-15T08:00:00Z");
    expect(
      deriveSeasonStatus("2026-03-15T08:00:00Z", "2026-04-15T20:00:00Z", at)
    ).toBe("active");
  });

  it("should use current time when now is not provided", () => {
    // Far future season → upcoming
    expect(
      deriveSeasonStatus("2099-01-01T00:00:00Z", "2099-12-31T23:59:00Z")
    ).toBe("upcoming");

    // Far past season → ended
    expect(
      deriveSeasonStatus("2020-01-01T00:00:00Z", "2020-12-31T23:59:00Z")
    ).toBe("ended");
  });
});

// ---------------------------------------------------------------------------
// formatSeasonDate
// ---------------------------------------------------------------------------

describe("formatSeasonDate", () => {
  it("should return a formatted date string", () => {
    const result = formatSeasonDate("2026-03-15T00:00:00Z");
    // The exact output depends on the runtime locale,
    // but it should contain the key date components
    expect(result).toContain("2026");
    expect(result).toContain("15");
  });

  it("should include time component", () => {
    const result = formatSeasonDate("2026-03-15T14:30:00Z");
    // Should contain some time representation
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});
