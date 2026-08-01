import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
