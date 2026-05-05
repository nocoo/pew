import { describe, it, expect } from "vitest";
import { toErrorMessage } from "@/lib/error-message";

describe("toErrorMessage", () => {
  it("returns Error.message for an Error instance", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the default fallback for non-Error values", () => {
    expect(toErrorMessage("nope")).toBe("Unknown error");
    expect(toErrorMessage(null)).toBe("Unknown error");
    expect(toErrorMessage(undefined)).toBe("Unknown error");
    expect(toErrorMessage(42)).toBe("Unknown error");
    expect(toErrorMessage({ message: "ignored" })).toBe("Unknown error");
  });

  it("uses the provided fallback for non-Error values", () => {
    expect(toErrorMessage("x", "Registration failed")).toBe("Registration failed");
    expect(toErrorMessage(null, "Withdrawal failed")).toBe("Withdrawal failed");
  });

  it("keeps Error.message even when a custom fallback is provided", () => {
    expect(toErrorMessage(new Error("real"), "Registration failed")).toBe("real");
  });

  it("preserves empty Error.message verbatim", () => {
    expect(toErrorMessage(new Error(""))).toBe("");
  });

  it("handles subclasses of Error", () => {
    class CustomError extends Error {}
    expect(toErrorMessage(new CustomError("custom"))).toBe("custom");
  });
});
