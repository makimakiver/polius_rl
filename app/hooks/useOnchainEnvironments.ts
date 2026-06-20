"use client";

import { useSuiClient } from "@mysten/dapp-kit";
import { useQuery } from "@tanstack/react-query";

const PKG = process.env.NEXT_PUBLIC_PKG_ID ?? "";

export interface OnchainEnv {
  id: string;
  name: string;
  description: string;
  deployer: string;
  artifactUri: string;
  walrusBlob?: string;
  verified: boolean;
  meanRewardBps?: number;
  passBps?: number;
  model?: string;
}

/** Live read of on-chain RL environments from emitted Move events. */
export function useOnchainEnvironments() {
  const client = useSuiClient();
  return useQuery({
    queryKey: ["onchain-environments", PKG],
    enabled: !!PKG,
    refetchInterval: 8000,
    queryFn: async (): Promise<OnchainEnv[]> => {
      const [registered, verified] = await Promise.all([
        client.queryEvents({
          query: { MoveEventType: `${PKG}::events::EnvRegistered` },
          limit: 50,
          order: "descending",
        }),
        client.queryEvents({
          query: { MoveEventType: `${PKG}::events::EnvVerified` },
          limit: 50,
          order: "descending",
        }),
      ]);

      // Latest EnvVerified per env (events are newest-first, so keep the first seen).
      const verifiedByEnv = new Map<
        string,
        { model?: string; meanRewardBps?: number; passBps?: number }
      >();
      for (const ev of verified.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const j: any = ev.parsedJson;
        if (!j?.env) continue;
        if (verifiedByEnv.has(j.env)) continue;
        verifiedByEnv.set(j.env, {
          model: j.model,
          meanRewardBps: Number(j.mean_reward_bps),
          passBps: Number(j.pass_bps),
        });
      }

      const seen = new Set<string>();
      const out: OnchainEnv[] = [];
      for (const ev of registered.data) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const j: any = ev.parsedJson;
        if (!j?.env || seen.has(j.env)) continue;
        seen.add(j.env);

        const artifactUri: string = j.artifact_uri ?? "";
        const walrusMatch = /^walrus:\/\/(.+)$/.exec(artifactUri);
        const v = verifiedByEnv.get(j.env);

        out.push({
          id: j.env,
          name: j.name ?? "",
          description: j.description ?? "",
          deployer: j.owner ?? "",
          artifactUri,
          walrusBlob: walrusMatch ? walrusMatch[1] : undefined,
          verified: !!v,
          meanRewardBps: v?.meanRewardBps,
          passBps: v?.passBps,
          model: v?.model,
        });
      }
      return out;
    },
  });
}
