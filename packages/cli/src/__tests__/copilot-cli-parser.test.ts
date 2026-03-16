import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCopilotCliFile } from "../parsers/copilot-cli.js";

/** Build a realistic process log snippet with an assistant_usage block */
function buildLogWithUsage(overrides: {
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  created_at?: string;
  kind?: string;
} = {}): string {
  const {
    model = "claude-opus-4.6",
    input_tokens = 56706,
    output_tokens = 1155,
    cache_read_tokens = 0,
    cache_write_tokens = 0,
    created_at = "2026-03-16T10:40:00.959Z",
    kind = "assistant_usage",
  } = overrides;

  return [
    `2026-03-16T10:40:00.873Z [INFO] CompactionProcessor: Utilization 27.5% (46283/168000 tokens) below threshold 80%`,
    `2026-03-16T10:40:00.959Z [INFO] [Telemetry] cli.telemetry:`,
    `{`,
    `  "kind": "${kind}",`,
    `  "properties": {`,
    `    "event_id": "068db2fe-4b7f-4f88-b2fd-450259a23239",`,
    `    "model": "${model}",`,
    `    "copilot_pid": "26207"`,
    `  },`,
    `  "metrics": {`,
    `    "input_tokens": ${input_tokens},`,
    `    "input_tokens_uncached": ${input_tokens - cache_read_tokens},`,
    `    "output_tokens": ${output_tokens},`,
    `    "cache_read_tokens": ${cache_read_tokens},`,
    `    "cache_write_tokens": ${cache_write_tokens},`,
    `    "cost": 3,`,
    `    "duration": 14468`,
    `  },`,
    `  "session_id": "ff76b1b9-dafb-4001-bf5f-568ed00e242e",`,
    `  "created_at": "${created_at}"`,
    `}`,
    `2026-03-16T10:40:00.960Z [DEBUG] Sending telemetry event: copilot-cli/cli.telemetry (kind: ${kind})`,
  ].join("\n") + "\n";
}

describe("parseCopilotCliFile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "pew-copilot-cli-parser-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty deltas and startOffset for missing file", async () => {
    const result = await parseCopilotCliFile({
      filePath: join(tempDir, "nonexistent.log"),
      startOffset: 0,
    });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(0);
  });

  it("returns endOffset equal to startOffset when file unchanged", async () => {
    const filePath = join(tempDir, "process-123.log");
    const content = buildLogWithUsage();
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({
      filePath,
      startOffset: content.length,
    });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(content.length);
  });

  it("extracts one delta from a single assistant_usage block", async () => {
    const filePath = join(tempDir, "process-123.log");
    const content = buildLogWithUsage({
      model: "claude-opus-4.6",
      input_tokens: 56706,
      output_tokens: 1155,
      cache_read_tokens: 0,
      created_at: "2026-03-16T10:40:00.959Z",
    });
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });

    expect(result.deltas).toHaveLength(1);
    const delta = result.deltas[0]!;
    expect(delta.source).toBe("copilot-cli");
    expect(delta.model).toBe("claude-opus-4.6");
    expect(delta.timestamp).toBe("2026-03-16T10:40:00.959Z");
    expect(delta.tokens.inputTokens).toBe(56706);
    expect(delta.tokens.outputTokens).toBe(1155);
    expect(delta.tokens.cachedInputTokens).toBe(0);
    expect(delta.tokens.reasoningOutputTokens).toBe(0);
  });

  it("extracts cached tokens correctly", async () => {
    const filePath = join(tempDir, "process-cache.log");
    const content = buildLogWithUsage({
      input_tokens: 66561,
      output_tokens: 491,
      cache_read_tokens: 55976,
    });
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });

    expect(result.deltas).toHaveLength(1);
    const delta = result.deltas[0]!;
    expect(delta.tokens.inputTokens).toBe(66561);
    expect(delta.tokens.cachedInputTokens).toBe(55976);
    expect(delta.tokens.outputTokens).toBe(491);
  });

  it("extracts multiple usage blocks from one file", async () => {
    const filePath = join(tempDir, "process-multi.log");
    const block1 = buildLogWithUsage({
      model: "claude-opus-4.6",
      input_tokens: 1000,
      output_tokens: 100,
      created_at: "2026-03-16T10:40:00.000Z",
    });
    const block2 = buildLogWithUsage({
      model: "gpt-5-mini",
      input_tokens: 500,
      output_tokens: 50,
      created_at: "2026-03-16T10:41:00.000Z",
    });
    await writeFile(filePath, block1 + block2);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });

    expect(result.deltas).toHaveLength(2);
    expect(result.deltas[0]!.model).toBe("claude-opus-4.6");
    expect(result.deltas[1]!.model).toBe("gpt-5-mini");
  });

  it("skips non-assistant_usage telemetry events", async () => {
    const filePath = join(tempDir, "process-skip.log");
    const content = buildLogWithUsage({ kind: "session_usage_info" });
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("skips events with all-zero tokens", async () => {
    const filePath = join(tempDir, "process-zeros.log");
    const content = buildLogWithUsage({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
    });
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
  });

  it("resumes from byte offset (only parses new content)", async () => {
    const filePath = join(tempDir, "process-resume.log");
    const block1 = buildLogWithUsage({
      input_tokens: 1000,
      output_tokens: 100,
      created_at: "2026-03-16T10:40:00.000Z",
    });
    await writeFile(filePath, block1);

    // First parse — gets block1
    const r1 = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(r1.deltas).toHaveLength(1);
    const endOffset = r1.endOffset;

    // Append block2
    const block2 = buildLogWithUsage({
      input_tokens: 2000,
      output_tokens: 200,
      created_at: "2026-03-16T10:41:00.000Z",
    });
    await writeFile(filePath, block1 + block2);

    // Resume from endOffset — only gets block2
    const r2 = await parseCopilotCliFile({ filePath, startOffset: endOffset });
    expect(r2.deltas).toHaveLength(1);
    expect(r2.deltas[0]!.tokens.inputTokens).toBe(2000);
  });

  it("endOffset equals file size after parsing", async () => {
    const filePath = join(tempDir, "process-eof.log");
    const content = buildLogWithUsage();
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(result.endOffset).toBe(content.length);
  });
});
