/**
 * Parse OpenRouter `/api/v1/models` JSON into normalized DynamicPricingEntry[].
 *
 * Pure function — no fetch, no time. `now` is injected for deterministic tests.
 */

import type { DynamicPricingEntry } from "./types";
import type { PublicContextTier } from "@pew/core";

interface OpenRouterApiResponse {
  data: Array<{
    id: string;
    name?: string;
    context_length?: number | null;
    pricing: {
      prompt: string;
      completion: string;
      input_cache_read?: string;
      input_cache_write?: string;
      input_cache_write_1h?: string;
      overrides?: Array<{ min_prompt_tokens?: number; prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string; input_cache_write_1h?: string }>;
    };
  }>;
}

export interface ParseResult {
  entries: DynamicPricingEntry[];
  warnings: string[];
}

const PROVIDER_DISPLAY: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  google: "Google",
  deepseek: "DeepSeek",
  mistral: "Mistral",
  mistralai: "Mistral",
  xai: "xAI",
  "x-ai": "xAI",
  minimax: "MiniMax",
  moonshotai: "Moonshot",
  qwen: "Alibaba",
  alibaba: "Alibaba",
  zhipuai: "Z.ai",
  "z-ai": "Z.ai",
  "github-copilot": "GitHub Copilot",
  meta: "Meta",
  "meta-llama": "Meta",
  nvidia: "Nvidia",
  bedrock: "Bedrock",
};

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function providerFromId(id: string): string {
  const slash = id.indexOf("/");
  let slug = slash >= 0 ? id.slice(0, slash) : id;
  if (slug.startsWith("~")) slug = slug.slice(1);
  return PROVIDER_DISPLAY[slug] ?? capitalize(slug);
}

function stripProviderPrefix(name: string, provider: string): string {
  const prefix = `${provider}: `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function parseDecimal(value: unknown): number | null {
  if (typeof value === "string" && value.trim() === "") return null;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function perMillion(value: unknown): number | null {
  const n = parseDecimal(value);
  return n === null || !Number.isFinite(n * 1_000_000) ? null : n * 1_000_000;
}

export function parseOpenRouter(json: unknown, now: string): ParseResult {
  const entries: DynamicPricingEntry[] = [];
  const warnings: string[] = [];

  const data = (json as OpenRouterApiResponse | null)?.data;
  if (!Array.isArray(data)) {
    return { entries, warnings: ["openrouter: response missing data[] array"] };
  }

  for (const raw of data) {
    if (!raw || typeof raw !== "object") {
      warnings.push("openrouter: skipped non-object entry");
      continue;
    }
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) {
      warnings.push("openrouter: skipped entry with empty id");
      continue;
    }
    const pricing = raw.pricing;
    if (!pricing || typeof pricing !== "object") {
      warnings.push(`openrouter: skipped ${id} — missing pricing`);
      continue;
    }
    const prompt = perMillion(pricing.prompt);
    const completion = perMillion(pricing.completion);
    if (prompt === null || completion === null) {
      warnings.push(`openrouter: skipped ${id} — invalid prompt/completion price`);
      continue;
    }
    const cacheRead = perMillion(pricing.input_cache_read);
    const contextTiers: PublicContextTier[] = [];
    if (Array.isArray(pricing.overrides)) for (const t of pricing.overrides) {
      if (!t || !Number.isSafeInteger(t.min_prompt_tokens) || Number(t.min_prompt_tokens) < 0) continue;
      const input = perMillion(t.prompt); const output = perMillion(t.completion);
      if (input === null || output === null) continue;
      contextTiers.push({ minInputTokens: Number(t.min_prompt_tokens), inputPerMillion: input, outputPerMillion: output,
        cachedPerMillion: perMillion(t.input_cache_read), cacheWritePerMillion: perMillion(t.input_cache_write), cacheWrite1hPerMillion: perMillion(t.input_cache_write_1h) });
    }

    const provider = providerFromId(id);
    const rawName = typeof raw.name === "string" ? raw.name : "";
    const displayName = rawName ? stripProviderPrefix(rawName, provider) : null;

    const ctx =
      typeof raw.context_length === "number" && Number.isFinite(raw.context_length)
        ? raw.context_length
        : null;

    entries.push({
      model: id,
      provider,
      displayName,
      inputPerMillion: prompt,
      outputPerMillion: completion,
      cachedPerMillion: cacheRead,
      cacheWritePerMillion: perMillion(pricing.input_cache_write),
      cacheWrite1hPerMillion: perMillion(pricing.input_cache_write_1h),
      route: "openrouter",
      ...(contextTiers.length ? { contextTiers: contextTiers.sort((a, b) => a.minInputTokens - b.minInputTokens) } : {}),
      contextWindow: ctx,
      origin: "openrouter",
      updatedAt: now,
    });
  }

  return { entries, warnings };
}
