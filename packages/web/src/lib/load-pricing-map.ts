/**
 * Server-only helper that loads the merged PricingMap.
 *
 * Two routes need this exact policy (`/api/pricing` and `/api/usage/by-device`)
 * — inlining it twice guarantees drift, so both go through here.
 *
 * Partial-degradation:
 *   - both succeed   → buildPricingMap({ dynamic, dbRows })
 *   - dynamic fails  → buildPricingMap({ dynamic: [], dbRows })
 *   - dbRows fails   → buildPricingMap({ dynamic, dbRows: [] })
 *   - both fail      → getDefaultPricingMap()  (prefix/source/fallback only)
 *
 * Never throws. Each rejection is logged with its source tag.
 */

import type { DbRead } from "./db";
import {
  buildPricingMap,
  getDefaultPricingMap,
  type PricingMap,
} from "./pricing";

type PricingMapDb = Pick<DbRead, "getDynamicPricing" | "listModelPricing">;

export async function loadPricingMap(db: PricingMapDb): Promise<PricingMap> {
  // Wrap the calls so a synchronous throw still becomes a rejected promise
  // and never escapes Promise.allSettled.
  const dynamicCall = (async () => db.getDynamicPricing())();
  const dbCall = (async () => db.listModelPricing())();

  const [dynamicSettled, dbSettled] = await Promise.allSettled([
    dynamicCall,
    dbCall,
  ]);

  if (dynamicSettled.status === "rejected") {
    console.error(
      "loadPricingMap: getDynamicPricing failed",
      dynamicSettled.reason,
    );
  }
  if (dbSettled.status === "rejected") {
    console.error(
      "loadPricingMap: listModelPricing failed",
      dbSettled.reason,
    );
  }

  if (
    dynamicSettled.status === "rejected" &&
    dbSettled.status === "rejected"
  ) {
    return getDefaultPricingMap();
  }

  const dynamic =
    dynamicSettled.status === "fulfilled"
      ? (dynamicSettled.value?.entries ?? [])
      : [];
  const dbRows =
    dbSettled.status === "fulfilled" ? (dbSettled.value ?? []) : [];

  return buildPricingMap({ dynamic, dbRows });
}
