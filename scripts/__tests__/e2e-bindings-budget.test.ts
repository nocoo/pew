import { afterEach, describe, expect, it, vi } from "vitest";
import { startLocalBindings } from "../e2e-utils";

function stubChild(pid: number, signalCode: string | null = null) {
  let exit: (code: number) => void;
  const exited = new Promise<number>((done) => { exit = done; });
  return { pid, exitCode: null as number | null, signalCode, exited, send: vi.fn(), exit: () => exit(137) };
}

function stubBun(child: ReturnType<typeof stubChild>) {
  vi.stubGlobal("Bun", { spawn: vi.fn(() => child) });
}

describe("Local bindings startup budget", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("lets PEW_E2E_BINDINGS_TIMEOUT_MS widen the default startup budget", async () => {
    // A wedged child is what the deadline exists to catch. The override keeps
    // the 900s default honest while letting a slow host raise it without a
    // code edit; the child here never reports ready, so only the override
    // can settle the call.
    vi.useFakeTimers();
    const child = stubChild(123457);
    stubBun(child);
    vi.stubEnv("PEW_E2E_BINDINGS_TIMEOUT_MS", "50");
    vi.spyOn(process, "kill").mockImplementation(() => true);
    const pending = startLocalBindings(new AbortController().signal);
    const settled = vi.fn();
    void pending.catch(settled);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(settled).toHaveBeenCalled();
    expect(child.send).toHaveBeenCalledWith("dispose");
  });

  it("ignores a non-positive or non-numeric override", async () => {
    // A bad value must keep the 900s default — a zero would otherwise disable
    // the deadline entirely — so each stubbed child must still be waiting
    // when the test ends, and an explicit 20ms caller budget must win.
    vi.useFakeTimers();
    for (const value of ["0", "-1", "abc", ""]) {
      const child = stubChild(123458);
      stubBun(child);
      vi.stubEnv("PEW_E2E_BINDINGS_TIMEOUT_MS", value);
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
      const pending = startLocalBindings(new AbortController().signal, 20).catch((error: unknown) => error);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(await pending).toBeInstanceOf(AggregateError);
      expect(kill).toHaveBeenCalledWith(-123458, "SIGKILL");
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
      kill.mockRestore();
    }
  });

  it("caps the disposal deadline below a long startup budget", async () => {
    // A child that ignores IPC will not start responding sooner because
    // startup was given a long budget, and the 900s default would make every
    // failure path wait 15 minutes per disposal step.
    vi.useFakeTimers();
    const child = stubChild(123460);
    stubBun(child);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const abort = new AbortController();
    const pending = startLocalBindings(abort.signal).catch((error: unknown) => error);
    abort.abort(new Error("synthetic interruption"));
    // Interrupt settles startup; the capped 30s disposal deadline then fires,
    // as does the equally capped forced-exit deadline after the SIGKILL.
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await pending).toBeInstanceOf(AggregateError);
    expect(kill).toHaveBeenCalledWith(-123460, "SIGKILL");
  });
});

describe("Local bindings disposal", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not signal-kill a child that already died from a signal", async () => {
    // A child killed by a signal keeps exitCode null, so an exitCode-only
    // liveness check sends SIGKILL to a gone process group and throws ESRCH
    // over the IPC error that explains what happened.
    stubBun(stubChild(123459, "SIGTERM"));
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    await expect(startLocalBindings(new AbortController().signal, 20)).rejects.toThrow("disposal timed out");
    expect(kill).not.toHaveBeenCalled();
  });
});
