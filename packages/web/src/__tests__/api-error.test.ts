import { describe, it, expect } from "vitest";

import { throwApiError } from "@/lib/api-error";

describe("throwApiError", () => {
  it("throws with error message from JSON body", async () => {
    const res = new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
    });
    await expect(throwApiError(res)).rejects.toThrow("Not found");
  });

  it("falls back to HTTP status when no error field", async () => {
    const res = new Response(JSON.stringify({}), { status: 500 });
    await expect(throwApiError(res)).rejects.toThrow("HTTP 500");
  });

  it("falls back to HTTP status when body is not JSON", async () => {
    const res = new Response("plain text", { status: 502 });
    await expect(throwApiError(res)).rejects.toThrow("HTTP 502");
  });
});
