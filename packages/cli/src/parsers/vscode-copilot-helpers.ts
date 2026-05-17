/**
 * Pure helpers extracted from vscode-copilot.ts.
 *
 * Each helper is byte-identical to its prior inline definition; the only
 * change is that they now live in a dedicated module so vscode-copilot.ts
 * can stay under the 400-LOC complexity guideline.
 */

/** Per-request metadata extracted from kind=0/2 lines */
export interface RequestMeta {
  modelId: string;
  timestamp: number;
}

/** Approximate chars-per-token ratio used for estimation. */
const CHARS_PER_TOKEN = 4;

/** Strip "copilot/" prefix from model IDs (e.g. "copilot/claude-opus-4.6" → "claude-opus-4.6") */
export function normalizeModelId(raw: string): string {
  return raw.startsWith("copilot/") ? raw.slice(8) : raw;
}

/**
 * Estimate tokens generated from tool call rounds that are NOT captured
 * in metadata.outputTokens.
 *
 * VSCode Copilot's outputTokens only counts the final visible text reply.
 * Two additional categories of model-generated content are omitted:
 *
 *   1. Tool call arguments (the JSON the model writes for each tool call)
 *      → added to outputTokens (model generated, billed as output)
 *
 *   2. Extended thinking text (reasoning blocks visible in thinking.text)
 *      → added to reasoningOutputTokens
 *
 * Additionally, `responseTokens` estimates the model's text response in each
 * round. This is only useful when metadata.outputTokens is absent (v3 format
 * without API-reported tokens) — callers with real outputTokens should ignore
 * this field to avoid double-counting.
 *
 * Returns integer estimates via floor(chars / CHARS_PER_TOKEN).
 */
export function estimateToolRoundTokens(rounds: unknown[]): {
  toolArgsTokens: number;
  thinkingTokens: number;
  responseTokens: number;
} {
  let toolArgsChars = 0;
  let thinkingChars = 0;
  let responseChars = 0;
  for (const round of rounds) {
    if (!round || typeof round !== "object") continue;
    const r = round as Record<string, unknown>;

    const toolCalls = r.toolCalls;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        if (tc && typeof tc === "object") {
          const args = (tc as Record<string, unknown>).arguments;
          if (typeof args === "string") toolArgsChars += args.length;
        }
      }
    }

    const thinking = r.thinking;
    if (thinking && typeof thinking === "object") {
      const text = (thinking as Record<string, unknown>).text;
      if (typeof text === "string") thinkingChars += text.length;
    }

    const response = r.response;
    if (typeof response === "string") responseChars += response.length;
  }
  return {
    toolArgsTokens: Math.floor(toolArgsChars / CHARS_PER_TOKEN),
    thinkingTokens: Math.floor(thinkingChars / CHARS_PER_TOKEN),
    responseTokens: Math.floor(responseChars / CHARS_PER_TOKEN),
  };
}

/**
 * Estimate input tokens for a v3 request from available metadata fields.
 *
 * When metadata.promptTokens is absent (common in newer VS Code builds),
 * we approximate input tokens from:
 *   - renderedUserMessage: the user's rendered prompt text
 *
 * This is a lower bound — actual input includes conversation history,
 * system prompts, and tool definitions that are not stored in the session file.
 */
export function estimateV3InputTokens(metadata: Record<string, unknown>): number {
  let chars = 0;

  const rum = metadata.renderedUserMessage;
  if (typeof rum === "string") {
    chars += rum.length;
  } else if (rum && typeof rum === "object") {
    chars += JSON.stringify(rum).length;
  }

  return Math.floor(chars / CHARS_PER_TOKEN);
}

/** Extract modelId and timestamp from a request object */
export function extractRequestMeta(
  req: Record<string, unknown>,
): RequestMeta | null {
  const rawModelId = req.modelId;
  const rawTimestamp = req.timestamp;

  if (typeof rawModelId !== "string" || !rawModelId) return null;
  if (typeof rawTimestamp !== "number" || !Number.isFinite(rawTimestamp)) return null;

  return {
    modelId: normalizeModelId(rawModelId),
    timestamp: rawTimestamp,
  };
}
