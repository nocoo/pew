"use client";

import { useAdmin } from "@/hooks/use-admin";
import { invalidatePricingEntries } from "@/hooks/use-pricing-entries";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Skeleton } from "@/components/ui/skeleton";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type {
  DynamicPricingEntryDto,
  DynamicPricingMetaDto,
} from "@/lib/rpc-types";
import { PricingTable } from "./pricing-table";
import { PricingMetaBanner } from "./pricing-meta-banner";
import { ForceSyncButton } from "./force-sync-button";

interface ModelsResponse {
  entries: DynamicPricingEntryDto[];
  servedFrom: "kv" | "baseline";
  meta: DynamicPricingMetaDto;
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function ModelPricesPage() {
  const { isAdmin } = useAdmin();

  const { data, error: swrError, isLoading: loading, mutate } =
    useSWR<ModelsResponse>("/api/pricing/models", fetcher);
  const error = swrError
    ? swrError instanceof Error
      ? swrError.message
      : "Failed to load."
    : null;

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Model Prices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dynamic pricing entries published by the worker-read sync (baseline JSON, openrouter, models.dev). Read-only view.
        </p>
      </div>

      <ErrorBanner messagePrefix="Failed to load" error={error} />

      {loading && !data && <PageSkeleton />}

      {data && (
        <>
          <PricingMetaBanner meta={data.meta} servedFrom={data.servedFrom}>
            {isAdmin && <ForceSyncButton onComplete={() => { void mutate(); invalidatePricingEntries(); }} />}
          </PricingMetaBanner>
          <PricingTable entries={data.entries} />
        </>
      )}
    </div>
  );
}
