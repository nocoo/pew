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
    // The override is a STARTUP budget only. With 50ms the startup deadline
    // fires at 50ms; disposal then runs to its own 30s cap (the child never
    // exits), so the call settles with an AggregateError at ~60s rather than
    // at ~5s — proving both that the override reached startup and that it
    // did not shorten disposal.
    vi.useFakeTimers();
    const child = stubChild(123457);
    stubBun(child);
    vi.stubEnv("PEW_E2E_BINDINGS_TIMEOUT_MS", "50");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const settled = vi.fn();
    const pending = startLocalBindings(new AbortController().signal)
      .catch((error: unknown) => { settled(error); return error; });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(70_000);
    const error = await pending;
    expect(settled).toHaveBeenCalled();
    // workbuddy branch wraps startup + cleanup failures in an AggregateError
    // whose members are the individual failures; at least one must name the
    // startup deadline (proving the override reached startup) and both
    // disposal errors must be present (proving disposal used the 30s cap,
    // not the 50ms override).
    expect(error).toBeInstanceOf(AggregateError);
    const errors = (error as AggregateError).errors as Error[];
    expect(errors[0]?.message).toContain("startup timed out");
    // Second member is dispose's own AggregateError: SIGKILL forced-exit
    // wrapper, whose inner members name the disposal and forced-exit deadlines.
    const cleanup = errors[1] as AggregateError;
    expect(cleanup).toBeInstanceOf(AggregateError);
    const inner = (cleanup.errors as Error[]).map((e) => e.message).join(" | ");
    expect(inner).toContain("disposal timed out");
    expect(inner).toContain("forced exit timed out");
    expect(kill).toHaveBeenCalled();
    expect(child.send).toHaveBeenCalledWith("dispose");
  });

  it("lets a small override shorten startup without shortening disposal", async () => {
    vi.useFakeTimers();
    const child = stubChild(123458);
    stubBun(child);
    vi.stubEnv("PEW_E2E_BINDINGS_TIMEOUT_MS", "20");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    const pending = startLocalBindings(new AbortController().signal).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(kill).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(await pending).toBeInstanceOf(AggregateError);
    expect(kill).toHaveBeenCalledWith(-123458, "SIGKILL");
  });

  it("keeps the default startup budget when the override is malformed", async () => {
    vi.useFakeTimers();
    for (const value of ["0", "-1", "abc", ""]) {
      const child = stubChild(123459);
      stubBun(child);
      vi.stubEnv("PEW_E2E_BINDINGS_TIMEOUT_MS", value);
      const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
      const settled = vi.fn();
      void startLocalBindings(new AbortController().signal)
        .catch((error: unknown) => { settled(error); return error; });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(settled).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(965_000);
      expect(settled).toHaveBeenCalled();
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
    // Startup and cleanup both surface as an AggregateError on this branch;
    // the cleanup member is itself an AggregateError naming the deadline.
    const error = await startLocalBindings(new AbortController().signal, 20).catch((e: unknown) => e) as AggregateError;
    expect(error).toBeInstanceOf(AggregateError);
    const cleanup = error.errors[1] as Error;
    expect(cleanup.message).toContain("disposal timed out");
    expect(kill).not.toHaveBeenCalled();
  });
});
