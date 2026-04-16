import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { log } from "../log.js";

describe("log", () => {
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    writeSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it("start() writes magenta icon + message", () => {
    log.start("syncing");
    expect(writeSpy).toHaveBeenCalledOnce();
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("syncing");
    expect(output).toContain("◐");
    expect(output.endsWith("\n")).toBe(true);
  });

  it("success() writes green icon + message", () => {
    log.success("done");
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("done");
    expect(output).toContain("✔");
  });

  it("info() writes cyan icon + message", () => {
    log.info("hello");
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("hello");
    expect(output).toContain("ℹ");
  });

  it("warn() writes yellow icon + message", () => {
    log.warn("careful");
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("careful");
    expect(output).toContain("⚠");
  });

  it("error() writes red icon + message", () => {
    log.error("failed");
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toContain("failed");
    expect(output).toContain("✖");
  });

  it("text() writes indented message without icon", () => {
    log.text("details here");
    const output = writeSpy.mock.calls[0][0] as string;
    expect(output).toBe("  details here\n");
  });

  it("blank() writes empty line", () => {
    log.blank();
    expect(writeSpy).toHaveBeenCalledWith("\n");
  });
});
