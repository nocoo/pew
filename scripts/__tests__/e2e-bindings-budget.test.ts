import { describe, expect, it, vi } from "vitest";
import { startLocalBindings } from "../e2e-utils";

describe("Local bindings startup budget", () => {
  it("lets PEW_E2E_BINDINGS_TIMEOUT_MS widen the default startup budget", async () => {
    // A wedged child is what the deadline exists to catch; on a host running
    // several other suites the real start has been measured at 99s against a
    // 60s default, which is a false failure, not a hang. The override keeps
    // the default honest while letting a slow host raise it without a code
    // edit (and without widening the budget in every other clone).
    let exit: (code: number) => void;
    const exited = new Promise<number>((done) => { exit = done; });
    const child = { pid: 123457, exitCode: null, exited, send: vi.fn() };
    vi.stubGlobal("Bun", { spawn: vi.fn(() => child) });
    vi.stubEnv("PEW_E2E_BINDINGS_TIMEOUT_MS", "50");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => { exit(137); return true; });
    const started = Date.now();
    try {
      const abort = new AbortController();
      await expect(startLocalBindings(abort.signal)).rejects.toThrow();
      // The child never reports ready, so this can only settle once the
      // widened budget (50ms) expires — proving the override was read.
      expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); kill.mockRestore(); }
  });

  it("ignores a non-positive or non-numeric override", async () => {
    for (const value of ["0", "-1", "abc", ""]) {
      let exit: (code: number) => void;
      const exited = new Promise<number>((done) => { exit = done; });
      const child = { pid: 123458, exitCode: null, exited, send: vi.fn() };
      vi.stubGlobal("Bun", { spawn: vi.fn(() => child) });
      vi.stubEnv("PEW_E2E_BINDINGS_TIMEOUT_MS", value);
      const kill = vi.spyOn(process, "kill").mockImplementation(() => { exit(137); return true; });
      try {
        const abort = new AbortController();
        // With a bad override the 60s default applies; an immediate failure
        // would mean the bogus value was used.
        await expect(startLocalBindings(abort.signal, 20)).rejects.toThrow("disposal timed out");
      } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); kill.mockRestore(); }
    }
  });
});
