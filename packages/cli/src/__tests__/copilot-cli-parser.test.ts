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

  it("extracts cached tokens as disjoint (prefers input_tokens_uncached)", async () => {
    const filePath = join(tempDir, "process-cache.log");
    // buildLogWithUsage emits input_tokens_uncached = input - cache_read
    const content = buildLogWithUsage({
      input_tokens: 66561,
      output_tokens: 491,
      cache_read_tokens: 55976,
    });
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });

    expect(result.deltas).toHaveLength(1);
    const delta = result.deltas[0]!;
    // uncached = 66561 - 55976 = 10585 (not full inclusive 66561)
    expect(delta.tokens.inputTokens).toBe(10585);
    expect(delta.tokens.cachedInputTokens).toBe(55976);
    expect(delta.tokens.outputTokens).toBe(491);
  });

  it("falls back to input - cache when input_tokens_uncached is absent", async () => {
    const filePath = join(tempDir, "process-no-uncached.log");
    // Hand-built telemetry without input_tokens_uncached (legacy)
    const content = [
      `2026-03-16T10:40:00.959Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  "properties": { "model": "claude-opus-4.6" },`,
      `  "metrics": {`,
      `    "input_tokens": 1000,`,
      `    "output_tokens": 50,`,
      `    "cache_read_tokens": 400`,
      `  },`,
      `  "created_at": "2026-03-16T10:40:00.959Z"`,
      `}`,
      ``,
    ].join("\n");
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.tokens.inputTokens).toBe(600);
    expect(result.deltas[0]!.tokens.cachedInputTokens).toBe(400);
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

  it("rewinds endOffset when file ends with incomplete JSON block", async () => {
    const filePath = join(tempDir, "process-incomplete.log");
    const completeBlock = buildLogWithUsage({
      input_tokens: 1000,
      output_tokens: 100,
      created_at: "2026-03-16T10:40:00.000Z",
    });
    // Simulate a telemetry header followed by a truncated JSON block
    const incompleteBlock = [
      `2026-03-16T10:41:00.000Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  "properties": {`,
    ].join("\n") + "\n";
    await writeFile(filePath, completeBlock + incompleteBlock);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });

    // Should parse the complete block but rewind past the incomplete one
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.tokens.inputTokens).toBe(1000);
    // endOffset should point to BEFORE the incomplete block's telemetry
    // marker line so the next sync re-reads the marker and re-enters
    // collectingJson mode
    expect(result.endOffset).toBe(completeBlock.length);
    expect(result.endOffset).toBeLessThan(completeBlock.length + incompleteBlock.length);
  });

  it("retries incomplete trailing block on next sync after file grows", async () => {
    const filePath = join(tempDir, "process-retry.log");
    const completeBlock = buildLogWithUsage({
      input_tokens: 1000,
      output_tokens: 100,
      created_at: "2026-03-16T10:40:00.000Z",
    });
    // First write: complete block + truncated second block
    const truncatedTail = [
      `2026-03-16T10:41:00.000Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  "properties": {`,
    ].join("\n") + "\n";
    await writeFile(filePath, completeBlock + truncatedTail);

    // First parse — gets block 1, rewinds before truncated block
    const r1 = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(r1.deltas).toHaveLength(1);
    expect(r1.endOffset).toBe(completeBlock.length);

    // File grows: the truncated block is now complete
    const completedTail = buildLogWithUsage({
      input_tokens: 2000,
      output_tokens: 200,
      created_at: "2026-03-16T10:41:00.000Z",
    });
    await writeFile(filePath, completeBlock + completedTail);

    // Second parse — resumes from r1.endOffset, re-reads the marker,
    // successfully parses the now-complete block
    const r2 = await parseCopilotCliFile({ filePath, startOffset: r1.endOffset });
    expect(r2.deltas).toHaveLength(1);
    expect(r2.deltas[0]!.tokens.inputTokens).toBe(2000);
    expect(r2.endOffset).toBe(completeBlock.length + completedTail.length);
  });

  it("handles braces inside JSON string values correctly", async () => {
    const filePath = join(tempDir, "process-braces.log");
    // Build a telemetry block where a string value contains braces
    const content = [
      `2026-03-16T10:40:00.959Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  "properties": {`,
      `    "event_id": "abc-123",`,
      `    "model": "claude-opus-4.6",`,
      `    "prompt_snippet": "write a function { foo }"`,
      `  },`,
      `  "metrics": {`,
      `    "input_tokens": 5000,`,
      `    "input_tokens_uncached": 5000,`,
      `    "output_tokens": 500,`,
      `    "cache_read_tokens": 0,`,
      `    "cache_write_tokens": 0`,
      `  },`,
      `  "created_at": "2026-03-16T10:40:00.959Z"`,
      `}`,
      `2026-03-16T10:40:01.000Z [DEBUG] Done`,
    ].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.tokens.inputTokens).toBe(5000);
    expect(result.deltas[0]!.tokens.outputTokens).toBe(500);
  });

  it("falls back to 'unknown' model when properties.model is missing", async () => {
    const filePath = join(tempDir, "process-nomodel.log");
    const content = [
      `2026-03-16T10:40:00.959Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  "properties": {`,
      `    "event_id": "abc-123"`,
      `  },`,
      `  "metrics": {`,
      `    "input_tokens": 3000,`,
      `    "input_tokens_uncached": 3000,`,
      `    "output_tokens": 200,`,
      `    "cache_read_tokens": 0,`,
      `    "cache_write_tokens": 0`,
      `  },`,
      `  "created_at": "2026-03-16T10:40:00.959Z"`,
      `}`,
      `2026-03-16T10:40:01.000Z [DEBUG] Done`,
    ].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.model).toBe("unknown");
  });

  it("falls back to 'unknown' model when properties.model is empty string", async () => {
    const filePath = join(tempDir, "process-emptymodel.log");
    const content = [
      `2026-03-16T10:40:00.959Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  "properties": {`,
      `    "event_id": "abc-123",`,
      `    "model": ""`,
      `  },`,
      `  "metrics": {`,
      `    "input_tokens": 1500,`,
      `    "input_tokens_uncached": 1500,`,
      `    "output_tokens": 100,`,
      `    "cache_read_tokens": 0,`,
      `    "cache_write_tokens": 0`,
      `  },`,
      `  "created_at": "2026-03-16T10:40:00.959Z"`,
      `}`,
      `2026-03-16T10:40:01.000Z [DEBUG] Done`,
    ].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.model).toBe("unknown");
  });

  it("skips events when created_at is missing (idempotent uploads require original timestamp)", async () => {
    const filePath = join(tempDir, "process-notime.log");
    const content = [
      `2026-03-16T10:40:00.959Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  "properties": {`,
      `    "event_id": "abc-123",`,
      `    "model": "claude-opus-4.6"`,
      `  },`,
      `  "metrics": {`,
      `    "input_tokens": 2000,`,
      `    "input_tokens_uncached": 2000,`,
      `    "output_tokens": 150,`,
      `    "cache_read_tokens": 0,`,
      `    "cache_write_tokens": 0`,
      `  }`,
      `}`,
      `2026-03-16T10:40:01.000Z [DEBUG] Done`,
    ].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    // Event without created_at should be skipped to preserve idempotency
    expect(result.deltas).toHaveLength(0);
    // endOffset should still advance past the content
    expect(result.endOffset).toBe(Buffer.byteLength(content, "utf8"));
  });

  it("recovers from malformed JSON and parses subsequent valid blocks", async () => {
    const filePath = join(tempDir, "process-corrupt.log");
    const corruptBlock = [
      `2026-03-16T10:39:00.000Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  THIS IS NOT VALID JSON!!!`,
      `}`,
    ].join("\n") + "\n";
    const validBlock = buildLogWithUsage({
      model: "gpt-5-mini",
      input_tokens: 4000,
      output_tokens: 300,
      created_at: "2026-03-16T10:41:00.000Z",
    });
    await writeFile(filePath, corruptBlock + validBlock);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    // Corrupt block is skipped, valid block is parsed
    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.model).toBe("gpt-5-mini");
    expect(result.deltas[0]!.tokens.inputTokens).toBe(4000);
  });

  it("handles file with log lines but no telemetry blocks", async () => {
    const filePath = join(tempDir, "process-notelem.log");
    const content = [
      `2026-03-16T10:40:00.000Z [INFO] Starting process`,
      `2026-03-16T10:40:01.000Z [DEBUG] Loading configuration`,
      `2026-03-16T10:40:02.000Z [INFO] Process ready`,
      `2026-03-16T10:40:03.000Z [INFO] Shutting down`,
    ].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(result.deltas).toHaveLength(0);
    expect(result.endOffset).toBe(content.length);
  });

  it("handles metrics with negative or non-numeric token values gracefully", async () => {
    const filePath = join(tempDir, "process-badmetrics.log");
    const content = [
      `2026-03-16T10:40:00.959Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  "properties": {`,
      `    "event_id": "abc-123",`,
      `    "model": "claude-opus-4.6"`,
      `  },`,
      `  "metrics": {`,
      `    "input_tokens": -100,`,
      `    "input_tokens_uncached": "not a number",`,
      `    "output_tokens": null,`,
      `    "cache_read_tokens": 0,`,
      `    "cache_write_tokens": 0`,
      `  },`,
      `  "created_at": "2026-03-16T10:40:00.959Z"`,
      `}`,
      `2026-03-16T10:40:01.000Z [DEBUG] Done`,
    ].join("\n") + "\n";
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });
    // toNonNegInt clamps negative/invalid to 0 → all zeros → filtered out
    expect(result.deltas).toHaveLength(0);
  });

  it("handles CRLF line endings correctly (Windows logs)", async () => {
    const filePath = join(tempDir, "process-crlf.log");
    const content = [
      `2026-03-16T10:40:00.873Z [INFO] CompactionProcessor: Utilization 27.5%`,
      `2026-03-16T10:40:00.959Z [INFO] [Telemetry] cli.telemetry:`,
      `{`,
      `  "kind": "assistant_usage",`,
      `  "properties": {`,
      `    "event_id": "abc-123",`,
      `    "model": "claude-opus-4.6"`,
      `  },`,
      `  "metrics": {`,
      `    "input_tokens": 5000,`,
      `    "input_tokens_uncached": 5000,`,
      `    "output_tokens": 500,`,
      `    "cache_read_tokens": 0,`,
      `    "cache_write_tokens": 0`,
      `  },`,
      `  "created_at": "2026-03-16T10:40:00.959Z"`,
      `}`,
      `2026-03-16T10:40:01.000Z [DEBUG] Done`,
    ].join("\r\n") + "\r\n";
    await writeFile(filePath, content);

    const result = await parseCopilotCliFile({ filePath, startOffset: 0 });

    expect(result.deltas).toHaveLength(1);
    expect(result.deltas[0]!.tokens.inputTokens).toBe(5000);
    // endOffset must equal the full file size (CRLF bytes included)
    expect(result.endOffset).toBe(Buffer.byteLength(content, "utf8"));
  });

  it("resumes correctly from byte offset in CRLF files", async () => {
    const filePath = join(tempDir, "process-crlf-resume.log");
    const block1 = buildLogWithUsage({
      input_tokens: 1000,
      output_tokens: 100,
      created_at: "2026-03-16T10:40:00.000Z",
    }).replace(/\n/g, "\r\n");
    await writeFile(filePath, block1);

    // First parse
    const r1 = await parseCopilotCliFile({ filePath, startOffset: 0 });
    expect(r1.deltas).toHaveLength(1);
    expect(r1.endOffset).toBe(Buffer.byteLength(block1, "utf8"));

    // Append second block (also CRLF)
    const block2 = buildLogWithUsage({
      input_tokens: 2000,
      output_tokens: 200,
      created_at: "2026-03-16T10:41:00.000Z",
    }).replace(/\n/g, "\r\n");
    await writeFile(filePath, block1 + block2);

    // Resume — should only get block2
    const r2 = await parseCopilotCliFile({ filePath, startOffset: r1.endOffset });
    expect(r2.deltas).toHaveLength(1);
    expect(r2.deltas[0]!.tokens.inputTokens).toBe(2000);
    expect(r2.endOffset).toBe(Buffer.byteLength(block1 + block2, "utf8"));
  });
});
