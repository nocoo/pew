/**
 * Merge baseline + upstream pricing layers into a deterministic
 * DynamicPricingEntry list.
 *
 * Pure function — caller injects `now` so meta.lastSyncedAt is testable.
 *
 * Layer order:
 *   baseline → openrouter → models.dev
 *
 * Zero-price protection: an upstream layer that reports 0 input AND 0 output
 * for an entry that already has positive prices is silently skipped. This
 * guards against transient upstream regressions wiping known-good prices.
 *
 * Alias-aware replacement: when an upstream entry arrives with a slashed
 * `provider/X` id and only a bare `X` exists (typically from the legacy
 * baseline), the upstream entry replaces the bare baseline under the slashed
 * canonical key. Without this, the bare baseline would freeze stale legacy
 * pricing while the slashed upstream entry sat alongside it, and the alias
 * expansion step would refuse to claim the bare name (already taken).
 */

import type {
  DynamicPricingEntry,
  DynamicPricingMeta,
} from "./types";

export interface MergeInput {
  baseline: DynamicPricingEntry[];
  openRouter: DynamicPricingEntry[];
  modelsDev: DynamicPricingEntry[];
  now: string;
}

export interface MergeResult {
  entries: DynamicPricingEntry[];
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
    const exact = byModel.get(entry.model);
    // Alias-aware: if no exact match but a bare baseline holds the suffix,
    // displace it. Only triggers for slashed upstream IDs where the suffix
    // matches a bare existing entry. Restricted to baseline so upstream
    // entries already keyed by slashed IDs aren't silently overwritten.
    let displaced: DynamicPricingEntry | undefined;
    let displacedKey: string | undefined;
    if (!exact) {
      const slash = entry.model.indexOf("/");
      if (slash >= 0) {
        const bare = entry.model.slice(slash + 1);
        const bareEntry = byModel.get(bare);
        if (bareEntry && bareEntry.origin === "baseline") {
          displaced = bareEntry;
          displacedKey = bare;
        }
      }
    }
    const prior = exact ?? displaced;
    if (shouldSkipForZeroPrice(prior, entry)) continue;
    if (displacedKey) byModel.delete(displacedKey);
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

  // 4. alias expansion (last)
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
    }
  }

  return {
    entries: sorted,
    meta: {
      lastSyncedAt: input.now,
      modelCount: sorted.length,
      baselineCount,
      openRouterCount,
      modelsDevCount,
    },
    warnings,
  };
}
