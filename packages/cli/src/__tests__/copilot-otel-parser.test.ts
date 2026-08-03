import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as FsPromises from "node:fs/promises";

/**
 * Lets a test run code in the window between the parser's `stat()` snapshot
 * and the read that follows it. Racing an append against the stat instead
 * would make the "append during parse" test flaky in exactly the direction
 * that hides the bug. The hook fires once, then clears itself.
 */
const statGate = vi.hoisted(() => ({
  afterStat: null as null | (() => Promise<unknown>),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      const result = await actual.stat(...args);
      const hook = statGate.afterStat;
      if (hook) {
        statGate.afterStat = null;
        await hook();
      }
      return result;
    },
  };
});

import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCopilotOtelFile } from "../parsers/copilot-otel.js";

function otelSpan(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: "span",
    traceId: "trace-1",
    spanId: "span-1",
    name: "chat gpt-5.5",
    startTime: [1_773_657_600, 959_000_000],
    attributes: {
      "gen_ai.provider.name": "github",
      "gen_ai.request.model": "gpt-5.5",
      "gen_ai.response.model": "gpt-5.5",
      "gen_ai.usage.input_tokens": 19_714,
      "gen_ai.usage.cache_read.input_tokens": 11_776,
      "gen_ai.usage.output_tokens": 38,
      "gen_ai.usage.reasoning.output_tokens": 18,
    },
    ...overrides,
  });
}

describe("parseCopilotOtelFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-copilot-otel-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("parses GitHub Copilot GenAI spans with disjoint token fields", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    await writeFile(filePath, `${otelSpan()}\n`);

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });

    expect(result.deltas).toEqual([
      {
        source: "copilot-cli",
        model: "gpt-5.5",
        timestamp: new Date(1_773_657_600_959).toISOString(),
        tokens: {
          inputTokens: 7_938,
          cachedInputTokens: 11_776,
          outputTokens: 20,
          reasoningOutputTokens: 18,
        },
      },
    ]);
    expect(result.endOffset).toBeGreaterThan(0);
  });

  it("resumes from the previous byte offset", async () => {
    const filePath = join(tempDir, "copilot-otel.jsonl");
    const first = `${otelSpan()}\n`;
    await writeFile(filePath, first);
    const r1 = await parseCopilotOtelFile({ filePath, startOffset: 0 });

    await appendFile(filePath, `${otelSpan({ traceId: "trace-2", spanId: "span-2" })}\n`);
    const r2 = await parseCopilotOtelFile({
      filePath,
      startOffset: r1.endOffset,
    });

    expect(r2.deltas).toHaveLength(1);
    expect(r2.endOffset).toBeGreaterThan(r1.endOffset);
  });

  it("ignores spans from non-GitHub providers", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    await writeFile(filePath, `${otelSpan({
      attributes: {
        "gen_ai.provider.name": "other",
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 10,
      },
    })}\n`);

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(result.deltas).toEqual([]);
  });

  it("leaves an incomplete trailing JSON line for the next sync", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    const complete = `${otelSpan()}\n`;
    await writeFile(filePath, `${complete}{"type":"span"`);

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.endOffset).toBe(Buffer.byteLength(complete));
  });

  it("does not replay spans appended after its stat snapshot", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    const first = `${otelSpan()}\n`;
    await writeFile(filePath, first);

    statGate.afterStat = () =>
      appendFile(filePath, `${otelSpan({ traceId: "trace-2", spanId: "span-2" })}\n`);
    const r1 = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(statGate.afterStat).toBeNull(); // hook fired

    // The appended span is outside the snapshot: neither emitted nor skipped.
    expect(r1.deltas).toHaveLength(1);
    expect(r1.endOffset).toBe(Buffer.byteLength(first));

    const r2 = await parseCopilotOtelFile({ filePath, startOffset: r1.endOffset });
    expect(r2.deltas).toHaveLength(1);
  });

  it("keeps byte accounting exact for CRLF files", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    const content = `${otelSpan()}\r\n${otelSpan({ traceId: "t2", spanId: "s2" })}\r\n`;
    await writeFile(filePath, content);

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(2);
    expect(result.endOffset).toBe(Buffer.byteLength(content));
  });

  it("skips malformed and blank lines without stalling the cursor", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    const content = `{not json\n\n${otelSpan()}\n`;
    await writeFile(filePath, content);

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.endOffset).toBe(Buffer.byteLength(content));
  });

  it("dedupes a span repeated within one file", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    await writeFile(filePath, `${otelSpan()}\n${otelSpan()}\n`);

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
  });

  it("accepts spans identified only by instrumentation scope", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    await writeFile(filePath, `${otelSpan({
      traceId: "t3",
      spanId: "s3",
      instrumentationScope: { name: "github.copilot" },
      attributes: {
        "gen_ai.usage.input_tokens": 100,
        "gen_ai.usage.output_tokens": 10,
      },
    })}\n`);

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    // No response/request model attribute — falls back to the span name.
    expect(result.deltas[0].model).toBe("gpt-5.5");
  });

  it("accepts an ISO string startTime and skips spans without one", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    await writeFile(filePath, `${otelSpan({ traceId: "t4", spanId: "s4", startTime: "2026-03-07T10:15:00.000Z" })}\n`);
    const iso = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(iso.deltas[0].timestamp).toBe("2026-03-07T10:15:00.000Z");

    const noTime = join(tempDir, "no-time.jsonl");
    await writeFile(noTime, `${otelSpan({ traceId: "t5", spanId: "s5", startTime: null })}\n`);
    expect((await parseCopilotOtelFile({ filePath: noTime, startOffset: 0 })).deltas).toEqual([]);
  });

  it("ignores non-span records and zero-usage spans", async () => {
    const filePath = join(tempDir, "otel.jsonl");
    await writeFile(filePath, [
      JSON.stringify({ type: "log", traceId: "t6", spanId: "s6" }),
      otelSpan({ traceId: "t7", spanId: "s7", attributes: { "gen_ai.provider.name": "github" } }),
      JSON.stringify({ type: "span", traceId: "t8", spanId: "s8" }),
      "",
    ].join("\n"));

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(result.deltas).toEqual([]);
  });

  it("returns startOffset when the file is missing or already consumed", async () => {
    const missing = join(tempDir, "nope.jsonl");
    expect(await parseCopilotOtelFile({ filePath: missing, startOffset: 7 })).toEqual({
      deltas: [],
      endOffset: 7,
    });

    const filePath = join(tempDir, "otel.jsonl");
    const content = `${otelSpan()}\n`;
    await writeFile(filePath, content);
    const size = Buffer.byteLength(content);
    expect(await parseCopilotOtelFile({ filePath, startOffset: size })).toEqual({
      deltas: [],
      endOffset: size,
    });
  });

  it("carries a partial line across stream chunks", async () => {
    // Exporter files run to tens of MB; the read arrives in 64 KB chunks, so a
    // record almost always straddles a chunk boundary. Byte accounting and the
    // final offset must survive that.
    const filePath = join(tempDir, "big.jsonl");
    const lines: string[] = [];
    for (let i = 0; i < 400; i++) {
      lines.push(otelSpan({ traceId: `t-${i}`, spanId: `s-${i}`, padding: "x".repeat(600) }));
    }
    const content = `${lines.join("\n")}\n`;
    expect(Buffer.byteLength(content)).toBeGreaterThan(64 * 1024);
    await writeFile(filePath, content);

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(400);
    expect(result.endOffset).toBe(Buffer.byteLength(content));
  });

  it("still counts spans with a partial or missing identifier", async () => {
    // Exporters have been seen emitting spans with only one of the two ids,
    // and dedup must not swallow distinct usage when neither is present.
    const filePath = join(tempDir, "otel.jsonl");
    await writeFile(filePath, [
      otelSpan({ traceId: "only-trace", spanId: undefined }),
      otelSpan({ traceId: undefined, spanId: "only-span" }),
      otelSpan({ traceId: undefined, spanId: undefined }),
      otelSpan({ traceId: undefined, spanId: undefined }),
      "",
    ].join("\n"));

    const result = await parseCopilotOtelFile({ filePath, startOffset: 0 });
    // Two identified spans (distinct ids) plus both unidentified ones.
    expect(result.deltas).toHaveLength(4);
  });
});
