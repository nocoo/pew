import { describe, expect, it, vi } from "vitest";
import worker, { type Env } from "./index";

const routes = ["/ingest", "/ingest/tokens", "/ingest/sessions", "/ingest/evidence", "/ingest/details"];
describe("Worker body limits", () => {
  it.each(routes)("rejects and cancels oversized %s before database work", async (path) => {
    const limit = path.endsWith("details") ? 24 * 1024 * 1024 : 1024 * 1024;
    const cancel = vi.fn();
    const prepare = vi.fn();
    const env = { WORKER_SECRET: "test", DB: { prepare } } as unknown as Env;
    const body = new ReadableStream({ start(c) { c.enqueue(new Uint8Array(limit + 1)); }, cancel });
    const request = new Request(`https://test.invalid${path}`, { method: "POST", body, duplex: "half",
      headers: { Authorization: "Bearer test" } } as RequestInit);
    const response = await worker.fetch(request, env);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "Request body too large" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(prepare).not.toHaveBeenCalled();
  });
});
