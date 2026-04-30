/**
 * Parse models.dev `/api.json` JSON into normalized DynamicPricingEntry[].
 *
 * Pure function — no fetch, no time. `now` is injected for deterministic tests.
 *
 * Provider whitelist: only providers we display ship pricing. Unknown providers
 * are skipped with a warning so we don't surface unmapped vendor labels in the
 * dashboard.
 */

import type { DynamicPricingEntry } from "./types";

export interface ModelsDevApiResponse {
  [providerId: string]: {
    models: {
      [modelId: string]: {
        name?: string;
        cost?: {
          input?: number;
          output?: number;
          cache_read?: number;
        };
        limit?: { context?: number };
      };
    };
  };
}

export interface ParseResult {
  entries: DynamicPricingEntry[];
  warnings: string[];
}

const PROVIDERS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  xai: "xAI",
  minimax: "MiniMax",
  moonshotai: "Moonshot",
  zai: "Z.ai",
  "github-copilot": "GitHub Copilot",
  alibaba: "Alibaba",
};

function nonNegativeNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
  return v;
}

export function parseModelsDev(json: unknown, now: string): ParseResult {
  const entries: DynamicPricingEntry[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { entries, warnings: ["models.dev: response is not an object"] };
  }

  const root = json as ModelsDevApiResponse;
  for (const providerId of Object.keys(root)) {
    const providerLabel = PROVIDERS[providerId];
    if (!providerLabel) {
      warnings.push(`models.dev: skipped unknown provider ${providerId}`);
      continue;
    }
    const providerBlock = root[providerId];
    const models = providerBlock?.models;
    if (!models || typeof models !== "object") {
      warnings.push(`models.dev: provider ${providerId} has no models{}`);
      continue;
    }
    for (const modelId of Object.keys(models)) {
      const m = models[modelId];
      if (!m || typeof m !== "object") {
        warnings.push(`models.dev: skipped ${providerId}/${modelId} — non-object entry`);
        continue;
      }
      const cost = m.cost;
      if (!cost || typeof cost !== "object") {
        warnings.push(`models.dev: skipped ${providerId}/${modelId} — missing cost`);
        continue;
      }
      const input = nonNegativeNumber(cost.input);
      const output = nonNegativeNumber(cost.output);
      if (input === null) {
        warnings.push(`models.dev: skipped ${providerId}/${modelId} — invalid input cost`);
        continue;
      }
      if (output === null) {
        warnings.push(`models.dev: skipped ${providerId}/${modelId} — invalid output cost`);
        continue;
      }
      const cacheRead = nonNegativeNumber(cost.cache_read);
      const ctx =
        typeof m.limit?.context === "number" && Number.isFinite(m.limit.context)
          ? m.limit.context
          : null;
      const displayName = typeof m.name === "string" && m.name.length > 0 ? m.name : null;

      entries.push({
        model: `${providerId}/${modelId}`,
        provider: providerLabel,
        displayName,
        inputPerMillion: input,
        outputPerMillion: output,
        cachedPerMillion: cacheRead,
        contextWindow: ctx,
        origin: "models.dev",
        updatedAt: now,
      });
    }
  }

  // Sanity guard: models.dev returns prices per-million-tokens.
  // If the median inputPerMillion is suspiciously low, the upstream API
  // may have switched to per-token units (off by 10^6).
  if (entries.length > 0) {
    const sorted = entries.map((e) => e.inputPerMillion).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median < 0.01) {
      warnings.push(
        `models.dev: median input price ${median} suggests per-token units (expected per-million)`,
      );
    }
  }

  return { entries, warnings };
}
