"use client";

import { InfoTooltip } from "@/components/info-tooltip";
import type { DynamicPricingMetaDto } from "@/lib/rpc-types";

export function PricingInformation({
  meta,
  servedFrom,
}: {
  meta: DynamicPricingMetaDto | undefined;
  servedFrom: "kv" | "baseline" | undefined;
}) {
  const fetchedAt = meta?.lastSyncedAt ? new Date(meta.lastSyncedAt) : null;
  const validDate = fetchedAt && Number.isFinite(fetchedAt.getTime());
  const outdated = validDate && Date.now() - fetchedAt.getTime() > 36 * 60 * 60_000;
  return (
    <InfoTooltip label="Model price information">
      <p>
        USD per million tokens at base context rates. Cache-write prices replace the normal input
        rate.
      </p>
      <p>Actual bills may differ. A dash means the price was not reported.</p>
      {validDate && <p>Updated {fetchedAt.toLocaleDateString()}.</p>}
      {(servedFrom === "baseline" || outdated || !!meta?.lastErrors?.length) && (
        <p>Some prices may be out of date.</p>
      )}
    </InfoTooltip>
  );
}
