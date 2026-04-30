/**
 * Merge baseline + upstream + admin pricing layers into a deterministic
 * DynamicPricingEntry list.
 *
 * Pure function — caller injects `now` so meta.lastSyncedAt is testable.
 *
 * Layer order:
 *   baseline → openrouter → models.dev → admin
 *
 * Zero-price protection: an upstream layer that reports 0 input AND 0 output
 * for an entry that already has positive prices is silently skipped. This
 * guards against transient upstream regressions wiping known-good prices.
 *
 * Admin rules:
 *   - row.source === null → overwrites/inserts the matching entry, origin='admin'.
 *   - row.source !== null → recorded in sourceOverrides side-channel only.
 *     The merge layer is intentionally ignorant of PricingMap; the consumer
 *     (web buildPricingMap) projects sourceOverrides into PricingMap.sourceDefaults
 *     and PricingMap.models[model] per existing semantics.
 */

import type {
  AdminPricingRow,
  DynamicPricingEntry,
  DynamicPricingMeta,
} from "./types";

export interface MergeInput {
  baseline: DynamicPricingEntry[];
  openRouter: DynamicPricingEntry[];
  modelsDev: DynamicPricingEntry[];
  admin: AdminPricingRow[];
  now: string;
}

export interface SourceOverride {
  source: string;
  pricing: { input: number; output: number; cached: number | null };
  model: string;
}

export interface MergeResult {
  entries: DynamicPricingEntry[];
  sourceOverrides: SourceOverride[];
  meta: Omit<DynamicPricingMeta, "lastErrors">;
  warnings: string[];
}

function shouldSkipForZeroPrice(
  existing: DynamicPricingEntry | undefined,
  incoming: DynamicPricingEntry
): boolean {
  if (!existing) return false;
  const incomingZero =
    incoming.inputPerMillion === 0 && incoming.outputPerMillion === 0;
  const existingPositive =
    existing.inputPerMillion > 0 || existing.outputPerMillion > 0;
  return incomingZero && existingPositive;
}

function cloneEntry(entry: DynamicPricingEntry): DynamicPricingEntry {
  return {
    ...entry,
    ...(entry.aliases ? { aliases: [...entry.aliases] } : {}),
  };
}

function applyLayer(
  byModel: Map<string, DynamicPricingEntry>,
  layer: DynamicPricingEntry[]
): void {
  for (const entry of layer) {
    if (shouldSkipForZeroPrice(byModel.get(entry.model), entry)) continue;
    byModel.set(entry.model, cloneEntry(entry));
  }
}

export function mergePricingSources(input: MergeInput): MergeResult {
  const warnings: string[] = [];
  const byModel = new Map<string, DynamicPricingEntry>();

  // 1. baseline
  for (const e of input.baseline) {
    byModel.set(e.model, { ...cloneEntry(e), origin: "baseline" });
  }
  // 2. openrouter
  applyLayer(byModel, input.openRouter);
  // 3. models.dev
  applyLayer(byModel, input.modelsDev);
  // 4. admin
  const sourceOverrides: SourceOverride[] = [];
  for (const row of input.admin) {
    if (row.source === null) {
      const existing = byModel.get(row.model);
      const next: DynamicPricingEntry = existing
        ? {
            ...cloneEntry(existing),
            inputPerMillion: row.input,
            outputPerMillion: row.output,
            cachedPerMillion: row.cached,
            origin: "admin",
            updatedAt: input.now,
          }
        : {
            model: row.model,
            provider: "Admin",
            displayName: null,
            inputPerMillion: row.input,
            outputPerMillion: row.output,
            cachedPerMillion: row.cached,
            contextWindow: null,
            origin: "admin",
            updatedAt: input.now,
          };
      byModel.set(row.model, next);
    } else {
      sourceOverrides.push({
        source: row.source,
        model: row.model,
        pricing: {
          input: row.input,
          output: row.output,
          cached: row.cached,
        },
      });
    }
  }

  // 5. alias expansion (last)
  // Stable ordering needed before alias decisions so test results are deterministic.
  const sorted = Array.from(byModel.values()).sort((a, b) => {
    if (a.provider !== b.provider) return a.provider < b.provider ? -1 : 1;
    return a.model < b.model ? -1 : a.model > b.model ? 1 : 0;
  });

  const claimed = new Set(sorted.map((e) => e.model));
  for (const entry of sorted) {
    const slash = entry.model.indexOf("/");
    if (slash < 0) continue;
    const bare = entry.model.slice(slash + 1);
    if (!bare || claimed.has(bare)) continue;
    // Only claim if no other entry already has this bare name AND no other
    // entry would also produce the same alias (collision check).
    const collisions = sorted.filter((e) => {
      const i = e.model.indexOf("/");
      return i >= 0 && e.model.slice(i + 1) === bare;
    });
    if (collisions.length > 1) continue;
    entry.aliases = entry.aliases ? [...entry.aliases, bare] : [bare];
    claimed.add(bare);
  }

  // counts by final origin
  let baselineCount = 0;
  let openRouterCount = 0;
  let modelsDevCount = 0;
  for (const e of sorted) {
    switch (e.origin) {
      case "baseline":
        baselineCount++;
        break;
      case "openrouter":
        openRouterCount++;
        break;
      case "models.dev":
        modelsDevCount++;
        break;
      // admin entries already counted via adminOverrideCount
    }
  }

  return {
    entries: sorted,
    sourceOverrides,
    meta: {
      lastSyncedAt: input.now,
      modelCount: sorted.length,
      baselineCount,
      openRouterCount,
      modelsDevCount,
      adminOverrideCount: input.admin.length,
    },
    warnings,
  };
}
