"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCurrentAccount } from "@mysten/dapp-kit";
import AppShell from "../components/AppShell";
import Sparkline from "../components/Sparkline";
import AgentCard from "../components/AgentCard";
import DeployButton from "../components/DeployButton";
import { useWalletModal } from "../components/wallet";
import { agents, agentRuns, aggregateCurve, agentReward, agentSuccess, type AgentStatus } from "../data/agents";
import { shortAddress } from "../data/environments";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const num = new Intl.NumberFormat("en-US");

const agentCurves = agents.map((a) => aggregateCurve(agentRuns(a)));
const avgCurve = agentCurves[0].map((_, i) => agentCurves.reduce((a, c) => a + (c[i] ?? 0), 0) / agentCurves.length);

const STATUS_FILTERS = ["All", "Active", "Training", "Idle"] as const;
const SORTS = { reward: "Reward", success: "Success", environments: "Environments", name: "Name" } as const;
type SortKey = keyof typeof SORTS;

export default function AgentsDashboard() {
  const account = useCurrentAccount();
  const { open } = useWalletModal();

  // operational state
  const [statuses, setStatuses] = useState<Record<string, AgentStatus>>(
    Object.fromEntries(agents.map((a) => [a.id, a.status]))
  );
  const [claimable, setClaimable] = useState<Record<string, number>>(
    Object.fromEntries(agents.map((a) => [a.id, a.claimable]))
  );

  // controls
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [sort, setSort] = useState<SortKey>("reward");

  const enriched = useMemo(
    () =>
      agents.map((a) => {
        const runs = agentRuns(a);
        return { agent: a, runs, reward: agentReward(runs), success: agentSuccess(runs) };
      }),
    []
  );

  const visible = enriched
    .filter((e) => (filter === "All" ? true : statuses[e.agent.id] === filter))
    .filter((e) => e.agent.name.toLowerCase().includes(query.toLowerCase().trim()))
    .sort((a, b) => {
      if (sort === "name") return a.agent.name.localeCompare(b.agent.name);
      if (sort === "environments") return b.runs.length - a.runs.length;
      if (sort === "success") return b.success - a.success;
      return b.reward - a.reward;
    });

  const totalClaimable = Object.values(claimable).reduce((s, v) => s + v, 0);
  const active = agents.filter((a) => statuses[a.id] === "Active").length;
  const totalReward = enriched.reduce((s, e) => s + e.reward, 0);
  const totalEnvs = enriched.reduce((s, e) => s + e.runs.length, 0);
  const avgSuccess = enriched.reduce((s, e) => s + e.success, 0) / enriched.length;

  const stats = [
    { label: "Agents", value: num.format(agents.length) },
    { label: "Active", value: num.format(active) },
    { label: "Env. joins", value: num.format(totalEnvs) },
    { label: "Total reward", value: `${compact.format(totalReward)} SUI` },
    { label: "Avg success", value: `${(avgSuccess * 100).toFixed(0)}%` },
  ];

  const toggle = (id: string) =>
    setStatuses((s) => ({ ...s, [id]: s[id] === "Idle" ? "Active" : "Idle" }));
  const claim = (id: string) => {
    if (!account) return open();
    setClaimable((c) => ({ ...c, [id]: 0 }));
  };
  const claimAll = () => {
    if (!account) return open();
    setClaimable(Object.fromEntries(agents.map((a) => [a.id, 0])));
  };

  return (
    <AppShell>
      <main className="theme-agent mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        {/* header with claimable summary */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/25 bg-accent/[0.06] p-6">
          <div>
            <p className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Agent fleet
            </p>
            <h1 className="text-3xl font-medium tracking-tight">Your agents</h1>
            <p className="mt-2 font-mono text-xs text-ink/50">
              {account ? `owner ${shortAddress(account.address, 10, 6)}` : "connect a wallet to manage your agents"}
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="text-right">
              <div className="font-mono text-[10px] uppercase tracking-wide text-ink/40">claimable rewards</div>
              <div className="font-mono text-2xl">{compact.format(totalClaimable)} SUI</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={claimAll}
                disabled={totalClaimable <= 0}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
              >
                {account ? "Claim all" : "Connect to claim"}
              </button>
              <DeployButton>+ New agent</DeployButton>
            </div>
          </div>
        </header>

        {/* KPI band */}
        <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-ink/15 bg-ink/10 sm:grid-cols-3 lg:grid-cols-5">
          {stats.map((s) => (
            <div key={s.label} className="bg-background p-4">
              <div className="font-mono text-xl">{s.value}</div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-ink/40">{s.label}</div>
            </div>
          ))}
        </section>

        {/* controls */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search agents…"
            className="w-44 rounded-md border border-ink/15 bg-white/60 px-3 py-1.5 text-sm outline-none transition-colors focus:border-accent placeholder:text-ink/30"
          />
          <div className="flex overflow-hidden rounded-md border border-ink/15">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 text-xs transition-colors ${
                  filter === f ? "bg-accent text-white" : "text-ink/60 hover:bg-ink/[0.04]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-wide text-ink/40">sort</span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rounded-md border border-ink/15 bg-white/60 px-2 py-1.5 text-sm outline-none focus:border-accent"
            >
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
        </div>

        {/* agent cards */}
        <section className="mt-5">
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink/20 p-8 text-center text-sm text-ink/50">
              No agents match your filters.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map(({ agent }) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  status={statuses[agent.id]}
                  claimable={claimable[agent.id]}
                  onToggle={() => toggle(agent.id)}
                  onClaim={() => claim(agent.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* fleet reward */}
        <section className="mt-8 rounded-lg border border-ink/15 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium uppercase tracking-wide">Fleet reward</h2>
            <span className="font-mono text-xs text-accent">+12.4% / 24h</span>
          </div>
          <Sparkline data={avgCurve} height={110} className="text-accent" />
        </section>
      </main>

      <footer className="border-t border-ink/15 px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between font-mono text-xs text-ink/40">
          <Link href="/" className="hover:text-ink">← dashboard</Link>
          <span>sui testnet</span>
        </div>
      </footer>
    </AppShell>
  );
}
