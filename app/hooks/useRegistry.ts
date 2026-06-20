"use client";

import { useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";

export interface OnChainVersion {
  blobId: string;
  passRateBps: number;
}

export interface OnChainRegistry {
  currentBest: number;
  totalCalls: number;
  feePoolMist: number;
  versions: OnChainVersion[];
  verifiedCalls: number;
  lastPassBps: number;
}

/** Live read of a ModelRegistry object from Sui (versions, fees, calls). */
export function useRegistry(registryId?: string) {
  const client = useSuiClient();
  return useQuery({
    queryKey: ["registry", registryId],
    enabled: !!registryId,
    refetchInterval: 5000,
    queryFn: async (): Promise<OnChainRegistry | null> => {
      if (!registryId) return null;
      const o = await client.getObject({ id: registryId, options: { showContent: true } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const f: any = (o.data?.content as any)?.fields;
      if (!f) return null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const versions: OnChainVersion[] = (f.versions ?? []).map((v: any) => ({
        blobId: v.fields?.walrus_blob_id ?? "",
        passRateBps: Number(v.fields?.pass_rate_bps ?? 0),
      }));
      return {
        currentBest: Number(f.current_best ?? 0),
        totalCalls: Number(f.total_calls ?? 0),
        feePoolMist: Number(f.fee_pool ?? 0),
        versions,
        verifiedCalls: Number(f.verified_calls ?? 0),
        lastPassBps: Number(f.last_pass_bps ?? 0),
      };
    },
  });
}
