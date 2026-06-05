import Link from "next/link";
import Sparkline from "./Sparkline";
import StatusPill from "./StatusPill";
import { shortAddress, type RlEnvironment } from "../data/environments";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** A single RL environment, rendered as a squared "console" card. */
export default function EnvironmentCard({ env }: { env: RlEnvironment }) {
  return (
    <Link
      href={`/rl/${env.id}`}
      className="group flex flex-col border border-ink/15 bg-white/40 p-4 transition-colors hover:border-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-medium tracking-tight">{env.name}</h3>
        <StatusPill status={env.status} />
      </div>

      <div className="mt-3 border border-ink/15 bg-ink/[0.03] p-3">
        <Sparkline data={env.rewardCurve} height={56} className="text-ink/70" fill={false} />
      </div>

      <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-ink/50">
        <span>{env.algorithm}</span>
        <span>{compact.format(env.reward)} SUI</span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-ink/40">by {shortAddress(env.deployer)}</div>

      <div className="mt-4 flex items-center justify-between border-t border-ink/10 pt-3 text-sm">
        <span className="text-ink/50">{(env.successRate * 100).toFixed(0)}% success</span>
        <span className="font-medium transition-all group-hover:translate-x-0.5 group-hover:text-accent">
          browse →
        </span>
      </div>
    </Link>
  );
}
