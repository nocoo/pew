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
    return buildPricingMap({ dynamic });
  } catch (err) {
    console.error("loadPricingMap: getDynamicPricing failed", err);
    return getDefaultPricingMap();
  }
}
