"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import Sparkline from "./Sparkline";
import {
  agentRuns,
  aggregateCurve,
  agentReward,
  agentSuccess,
  type Agent,
  type AgentStatus,
} from "../data/agents";

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

function StatusTag({ status }: { status: string }) {
  const cls =
    status === "Active" ? "bg-accent" : status === "Training" ? "bg-ink" : "bg-transparent border border-ink/40";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink/60">
      <span className={`h-1.5 w-1.5 rounded-full ${cls}`} />
      {status}
    </span>
  );
}

export default function AgentCard({
  agent,
  status,
  claimable,
  onToggle,
  onClaim,
}: {
  agent: Agent;
  status: AgentStatus;
  claimable: number;
  onToggle: () => void;
  onClaim: () => void;
}) {
  const runs = agentRuns(agent);
  const agg = aggregateCurve(runs);
  const reward = agentReward(runs);
  const success = agentSuccess(runs);
  const multi = runs.length > 1;

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <>
      <div className="flex flex-col rounded-xl border border-ink/15 bg-white/50 shadow-sm transition-all hover:border-accent hover:shadow-md">
        {/* info area — opens the per-RL breakdown */}
        <button onClick={() => setOpen(true)} className="group flex flex-col p-4 text-left">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-semibold text-background">
                {agent.name.split("-")[1]?.[0] ?? "H"}
              </span>
              <div>
                <h3 className="text-base font-medium tracking-tight group-hover:text-accent">{agent.name}</h3>
                <div className="font-mono text-[11px] text-ink/40">{agent.model}</div>
              </div>
            </div>
            <StatusTag status={status} />
          </div>

          <div className="mt-3 rounded-md border border-ink/15 bg-ink/[0.03] p-2">
            <Sparkline data={agg} height={38} className="text-accent" fill={false} />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-ink/10 pt-3 text-center">
            <Metric value={String(runs.length)} label="environments" />
            <Metric value={`${compact.format(reward)}`} label="reward" />
            <Metric value={`${(success * 100).toFixed(0)}%`} label="success" />
          </div>

          <div className="mt-2 text-right font-mono text-[11px] text-ink/40 group-hover:text-accent">
            {multi ? `view ${runs.length} graphs →` : "view →"}
          </div>
        </button>

        {/* action footer */}
        <div className="flex items-center justify-between gap-2 border-t border-ink/10 px-4 py-3">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wide text-ink/40">claimable</div>
            <div className="font-mono text-sm">{compact.format(claimable)} SUI</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onToggle}
              className="rounded-md border border-ink/20 px-2.5 py-1.5 text-xs font-medium text-ink/70 transition-colors hover:border-ink hover:text-ink"
            >
              {status === "Idle" ? "Resume" : "Pause"}
            </button>
            <button
              onClick={onClaim}
              disabled={claimable <= 0}
              className="rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Claim
            </button>
          </div>
        </div>
      </div>

      {mounted && open &&
        createPortal(
          <div className="theme-agent fixed inset-0 z-[100] flex items-center justify-center p-4">
            <button aria-label="Close" onClick={() => setOpen(false)} className="wm-overlay absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
            <div className="wm-panel relative max-h-[88vh] w-full max-w-2xl overflow-auto rounded-xl border border-ink/15 bg-background shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-ink/15 px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-xs font-semibold text-background">
                    {agent.name.split("-")[1]?.[0] ?? "H"}
                  </span>
                  <div>
                    <h2 className="text-base font-medium tracking-tight">{agent.name}</h2>
                    <p className="font-mono text-[11px] text-ink/50">
                      {agent.model} · active in {runs.length} environment{runs.length > 1 ? "s" : ""}
                    </p>
                  </div>
                </div>
                <button onClick={() => setOpen(false)} aria-label="Close" className="flex h-7 w-7 items-center justify-center border border-ink/15 text-ink/60 transition-colors hover:border-ink hover:text-ink">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>

              <div className="p-5">
                <div className="mb-5">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="font-mono text-[11px] uppercase tracking-wide text-ink/50">Aggregate</span>
                    <span className="font-mono text-[11px] text-ink/40">{compact.format(reward)} SUI · {(success * 100).toFixed(0)}%</span>
                  </div>
                  <div className="rounded-md border border-ink/15 bg-ink/[0.03] p-3">
                    <Sparkline data={agg} height={70} className="text-accent" />
                  </div>
                </div>

                {multi && <p className="mb-3 font-mono text-[11px] uppercase tracking-wide text-ink/50">Per environment</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  {runs.map((run) => (
                    <Link key={run.envId} href={`/rl/${run.envId}`} className="group block rounded-lg border border-ink/15 bg-white/40 p-3 transition-colors hover:border-accent">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium group-hover:text-accent">{run.envName}</span>
                        <StatusTag status={run.status} />
                      </div>
                      <div className="mt-2 rounded-md border border-ink/15 bg-ink/[0.03] p-2">
                        <Sparkline data={run.curve} height={40} className="text-accent" fill={false} />
                      </div>
                      <div className="mt-2 flex items-center justify-between font-mono text-[11px] text-ink/50">
                        <span>{compact.format(run.reward)} SUI</span>
                        <span>{(run.successRate * 100).toFixed(0)}% success</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-mono text-sm">{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-wide text-ink/40">{label}</div>
    </div>
  );
}
