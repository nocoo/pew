/**
 * Server-only helper that loads the merged PricingMap.
 *
 * Two routes need this exact policy (`/api/pricing` and `/api/usage/by-device`)
 * — inlining it twice guarantees drift, so both go through here.
 *
 * Partial-degradation:
 *   - dynamic succeeds → buildPricingMap({ dynamic })
 *   - dynamic fails    → getDefaultPricingMap() (prefix/source/fallback only)
 *
 * Never throws. Each rejection is logged with its source tag.
 */

import type { DbRead } from "./db";
import { createHash } from "node:crypto";
import {
  buildPricingMap,
  getDefaultPricingMap,
  type PricingMap,
} from "./pricing";

type PricingMapDb = Pick<DbRead, "getDynamicPricing">;

export async function loadPricingMap(db: PricingMapDb): Promise<PricingMap> {
  try {
    const dynamicResult = await db.getDynamicPricing();
    const dynamic = dynamicResult?.entries ?? [];
    const map = buildPricingMap({ dynamic });
    // Price identity excludes fetch timestamps: fetchedAt is not effectiveAt.
    const snapshot = JSON.stringify(dynamic, (key, value) => key === "updatedAt" ? undefined : value);
    map.meta = { status: dynamic.length === 0 ? "fallback" : dynamicResult.servedFrom === "baseline" ? "baseline" : "dynamic",
      snapshotId: createHash("sha256").update(snapshot || "[]").digest("hex"),
      fetchedAt: dynamic.map((e) => e.updatedAt).filter(Boolean).sort().at(-1) ?? null, effectiveAt: null };
    return map;
  } catch {
    console.error("loadPricingMap: dynamic pricing unavailable");
    const map = getDefaultPricingMap();
    map.meta = { status: "fallback", snapshotId: createHash("sha256").update(JSON.stringify(map)).digest("hex"), fetchedAt: null, effectiveAt: null };
    return map;
  }
}
