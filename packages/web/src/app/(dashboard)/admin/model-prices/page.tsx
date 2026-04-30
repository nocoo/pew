"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdmin } from "@/hooks/use-admin";
import { Skeleton } from "@/components/ui/skeleton";
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
  const router = useRouter();
  const { isAdmin, loading: adminLoading } = useAdmin();

  const [data, setData] = useState<ModelsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!adminLoading && !isAdmin) {
      router.replace("/");
    }
  }, [adminLoading, isAdmin, router]);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/pricing/models");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as ModelsResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data-fetching effect: standard React pattern
    if (isAdmin) fetchModels();
  }, [isAdmin, fetchModels]);

  if (adminLoading) return <PageSkeleton />;
  if (!isAdmin) return null;

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold font-display tracking-tight">Model Prices</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Dynamic pricing entries published by the worker-read sync. Read-only view; edits go through{" "}
          <a className="underline" href="/admin/pricing">Token Pricing</a>.
        </p>
      </div>

      {error && (
        <div className="rounded-card bg-destructive/10 p-4 text-sm text-destructive">
          Failed to load: {error}
        </div>
      )}

      {loading && !data && <PageSkeleton />}

      {data && (
        <>
          <PricingMetaBanner meta={data.meta} servedFrom={data.servedFrom}>
            <ForceSyncButton onComplete={() => fetchModels()} />
          </PricingMetaBanner>
          <PricingTable entries={data.entries} />
        </>
      )}
    </div>
  );
}
