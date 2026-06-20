import { shortAddress } from "../lib/format";
import type { OnchainEnv } from "../hooks/useOnchainEnvironments";

const NET = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet";

/** A single on-chain RL environment, styled to echo EnvironmentCard. */
export default function OnchainEnvCard({ env }: { env: OnchainEnv }) {
  return (
    <div className="group flex flex-col border border-ink/15 bg-white/40 p-4 transition-colors hover:border-accent">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-medium tracking-tight">{env.name || "untitled env"}</h3>
        {env.verified ? (
          <span className="shrink-0 rounded-full border border-emerald-600/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] text-emerald-700">
            ✓ verified
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-ink/15 bg-ink/[0.04] px-2 py-0.5 font-mono text-[10px] text-ink/45">
            unverified
          </span>
        )}
      </div>

      <p className="mt-2 line-clamp-3 text-sm text-ink/60">{env.description}</p>

      <div className="mt-3 border border-ink/15 bg-ink/[0.03] p-3 text-[11px]">
        {env.verified ? (
          <span className="font-mono text-emerald-700">
            ✓ Nautilus-verified · reward {((env.meanRewardBps ?? 0) / 100).toFixed(2)}% · pass{" "}
            {((env.passBps ?? 0) / 100).toFixed(2)}%
          </span>
        ) : (
          <span className="font-mono text-ink/45">awaiting on-chain verification</span>
        )}
      </div>

      <div className="mt-3 font-mono text-[11px] text-ink/40">
        by {shortAddress(env.deployer)}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-ink/10 pt-3 font-mono text-[11px]">
        {env.walrusBlob && (
          <a
            href={`https://walruscan.com/${NET}/blob/${env.walrusBlob}`}
            target="_blank"
            rel="noreferrer"
            className="text-ink/55 transition-colors hover:text-accent"
          >
            dataset on Walrus ↗
          </a>
        )}
        <a
          href={`https://suiscan.xyz/${NET}/object/${env.id}`}
          target="_blank"
          rel="noreferrer"
          className="text-ink/55 transition-colors hover:text-accent"
        >
          on Sui ↗
        </a>
      </div>
    </div>
  );
}
