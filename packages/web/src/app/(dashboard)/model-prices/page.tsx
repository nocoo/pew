"use client";

import { useAdmin } from "@/hooks/use-admin";
import { invalidatePricingEntries } from "@/hooks/use-pricing-entries";
import { ErrorBanner } from "@/components/error-banner";
import { PageHeader } from "@nocoo/basalt/components/page-header";
import { Skeleton } from "@nocoo/basalt/components/skeleton";
import useSWR from "swr";
import { fetcher } from "@/lib/fetcher";
import type { DynamicPricingEntryDto, DynamicPricingMetaDto } from "@/lib/rpc-types";
import { PricingTable } from "./pricing-table";
import { PricingInformation } from "./pricing-information";
import { ForceSyncButton } from "./force-sync-button";

interface ModelsResponse {
  entries: DynamicPricingEntryDto[];
  servedFrom: "kv" | "baseline";
  meta: DynamicPricingMetaDto;
}

function PageSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton style={{ width: undefined }} className="h-8 w-48" />
      <Skeleton style={{ width: undefined }} className="h-16 w-full" />
      <Skeleton style={{ width: undefined }} className="h-64 w-full" />
    </div>
  );
}

export default function ModelPricesPage() {
  const { isAdmin } = useAdmin();

  const {
    data,
    error: swrError,
    isLoading: loading,
    mutate,
  } = useSWR<ModelsResponse>("/api/pricing/models", fetcher);
  const error = swrError
    ? swrError instanceof Error
      ? swrError.message
      : "Failed to load."
    : null;

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Model Prices"
        description="Compare published model prices."
        actions={
          <>
            <PricingInformation meta={data?.meta} servedFrom={data?.servedFrom} />
            {isAdmin && (
              <ForceSyncButton
                onComplete={() => {
                  void mutate();
                  invalidatePricingEntries();
                }}
              />
            )}
          </>
        }
      />

      <ErrorBanner messagePrefix="Failed to load" error={error} />

      {loading && !data && <PageSkeleton />}

      {data && <PricingTable entries={data.entries} />}
    </div>
  );
}
