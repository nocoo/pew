import { localIsolatedEnv } from "./local-e2e-bindings";

const abort = new AbortController();
let release: () => void;
const closing = new Promise<void>((done) => {
  release = done;
});
process.on("message", (message) => {
  if (message === "dispose") {
    abort.abort();
    release();
  }
});
process.on("disconnect", () => {
  abort.abort();
  release();
});
let local: Awaited<ReturnType<typeof localIsolatedEnv>> | undefined;
try {
  local = await localIsolatedEnv(
    undefined,
    abort.signal,
    process.env.PEW_SEED_READINESS === "true",
  );
  process.send?.({ env: local.env, state: local.state });
  await closing;
} catch (error) {
  if (!abort.signal.aborted) throw error;
} finally {
  await local?.dispose();
  if (process.connected) process.disconnect?.();
}
