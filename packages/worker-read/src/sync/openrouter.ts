/**
 * Parse OpenRouter `/api/v1/models` JSON into normalized DynamicPricingEntry[].
 *
 * Pure function — no fetch, no time. `now` is injected for deterministic tests.
 */

import type { DynamicPricingEntry } from "./types";

export interface OpenRouterApiResponse {
  data: Array<{
    id: string;
    name?: string;
    context_length?: number | null;
    pricing: {
      prompt: string;
      completion: string;
      input_cache_read?: string;
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
  const slug = slash >= 0 ? id.slice(0, slash) : id;
  if (slug.startsWith("~")) return "OpenRouter";
  return PROVIDER_DISPLAY[slug] ?? capitalize(slug);
}

function stripProviderPrefix(name: string, provider: string): string {
  const prefix = `${provider}: `;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function parseDecimal(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
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
    const prompt = parseDecimal(pricing.prompt);
    const completion = parseDecimal(pricing.completion);
    if (prompt === null || completion === null) {
      warnings.push(`openrouter: skipped ${id} — invalid prompt/completion price`);
      continue;
    }
    const cacheRead = parseDecimal(pricing.input_cache_read);

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
      inputPerMillion: prompt * 1_000_000,
      outputPerMillion: completion * 1_000_000,
      cachedPerMillion: cacheRead === null ? null : cacheRead * 1_000_000,
      contextWindow: ctx,
      origin: "openrouter",
      updatedAt: now,
    });
  }

  return { entries, warnings };
}
