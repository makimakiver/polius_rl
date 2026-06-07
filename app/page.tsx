import Link from "next/link";
import AppShell from "./components/AppShell";
import Sparkline from "./components/Sparkline";
import EnvironmentCard from "./components/EnvironmentCard";
import DeployButton from "./components/DeployButton";
import AgentLoopVisual from "./components/AgentLoopVisual";
import ContractDemo from "./components/ContractDemo";
import { environments } from "./data/environments";
import { agents, agentRuns, aggregateCurve, agentReward } from "./data/agents";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const num = new Intl.NumberFormat("en-US");

const fleetCurve = environments[0].rewardCurve.map((_, i) =>
  environments.reduce((s, e) => s + (e.rewardCurve[i] ?? 0), 0) / environments.length
);

const activity = [
  { text: "Hermes-Gamma deployed to CartPole Swarm", meta: "2m ago" },
  { text: "Reward payout settled on Sui", meta: "412 SUI · 18m ago" },
  { text: "Market Maker Bandit checkpoint saved", meta: "1h ago" },
  { text: "Hermes-Beta started training", meta: "2h ago" },
];

export default function Home() {
  const totalReward = environments.reduce((s, e) => s + e.reward, 0);
  const avgSuccess = environments.reduce((s, e) => s + e.successRate, 0) / environments.length;
  const featured = [...environments].sort((a, b) => b.reward - a.reward).slice(0, 3);

  const agentRows = agents
    .map((a) => {
      const runs = agentRuns(a);
      return { agent: a, envs: runs.length, reward: agentReward(runs), curve: aggregateCurve(runs) };
    })
    .sort((a, b) => b.reward - a.reward);

  const stats = [
    { label: "Environments", value: num.format(environments.length) },
    { label: "Agents", value: num.format(agents.length) },
    { label: "Total reward", value: `${compact.format(totalReward)} SUI` },
    { label: "Avg success", value: `${(avgSuccess * 100).toFixed(0)}%` },
  ];

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 sm:px-8">
        {/* Hero */}
        <section className="grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.25em] text-ink/50">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Agentic RL · on Sui
            </p>
            <h1 className="mt-4 max-w-2xl text-3xl font-medium leading-tight tracking-tight sm:text-4xl">
              Train, deploy &amp; reward autonomous agents on-chain.
            </h1>
            <p className="mt-4 max-w-xl text-sm leading-6 text-ink/60">
              A marketplace of RL environments and the Hermes agents that learn in them.
              Connect your Sui wallet to deploy, train, and claim rewards.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <DeployButton>Deploy environment</DeployButton>
              <Link href="/environments" className="text-sm text-ink/60 underline-offset-4 hover:text-accent hover:underline">
                Browse environments →
              </Link>
            </div>
          </div>
          <AgentLoopVisual className="max-w-xl justify-self-center lg:justify-self-end" />
        </section>

        {/* Overview KPIs */}
        <section className="grid grid-cols-2 gap-px overflow-hidden border border-ink/15 bg-ink/10 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-background p-4">
              <div className="font-mono text-2xl">{s.value}</div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-ink/40">{s.label}</div>
            </div>
          ))}
        </section>

        {/* Featured + activity */}
        <div className="mt-10 grid gap-8 lg:grid-cols-[1.6fr_1fr]">
          <section>
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-ink/50">Featured environments</h2>
              <Link href="/environments" className="font-mono text-xs text-ink/50 underline-offset-4 hover:text-accent hover:underline">
                view all →
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {featured.map((env) => (
                <EnvironmentCard key={env.id} env={env} />
              ))}
            </div>
          </section>

          <aside className="flex flex-col gap-6">
            <section className="border border-ink/15 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide">Network reward</h2>
                <span className="font-mono text-xs text-accent">+12.4% / 24h</span>
              </div>
              <Sparkline data={fleetCurve} height={80} className="text-accent" />
            </section>

            <section className="border border-ink/15 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-medium uppercase tracking-wide">Recent activity</h2>
                <Link href="/agents" className="font-mono text-[11px] text-ink/40 underline-offset-4 hover:text-accent hover:underline">
                  agents →
                </Link>
              </div>
              <ul className="space-y-4">
                {activity.map((a) => (
                  <li key={a.text} className="flex items-start gap-3">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                    <div>
                      <p className="text-sm leading-snug text-ink/80">{a.text}</p>
                      <p className="font-mono text-[11px] text-ink/40">{a.meta}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        {/* Smart contract execution demo (zkLogin + normal wallets) */}
        <ContractDemo />

        {/* Your agents */}
        <section className="mt-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-ink/50">Your agents</h2>
            <Link href="/agents" className="font-mono text-xs text-ink/50 underline-offset-4 hover:text-accent hover:underline">
              view all →
            </Link>
          </div>
          <div className="divide-y divide-ink/10 overflow-hidden rounded-lg border border-ink/15">
            {agentRows.map(({ agent, envs, reward, curve }) => {
              const tone =
                agent.status === "Active" ? "bg-accent" : agent.status === "Training" ? "bg-ink" : "bg-transparent border border-ink/40";
              return (
                <Link
                  key={agent.id}
                  href="/agents"
                  className="group flex items-center gap-4 px-4 py-3 transition-colors hover:bg-accent/[0.04]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-background">
                    {agent.name.split("-")[1]?.[0] ?? "H"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium group-hover:text-accent">{agent.name}</div>
                    <div className="font-mono text-[11px] text-ink/40">{agent.model}</div>
                  </div>
                  <span className="hidden w-24 sm:block">
                    <Sparkline data={curve} height={24} className="text-accent" fill={false} />
                  </span>
                  <span className="hidden w-20 text-right font-mono text-xs text-ink/60 sm:block">{envs} envs</span>
                  <span className="w-24 text-right font-mono text-xs">{compact.format(reward)} SUI</span>
                  <span className="inline-flex w-20 shrink-0 items-center justify-end gap-1.5 text-[11px] uppercase tracking-wide text-ink/60">
                    <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
                    {agent.status}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </main>

      <footer className="mt-12 border-t border-ink/15 px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between font-mono text-xs text-ink/40">
          <span>© {new Date().getFullYear()} pollius rl — sample ui</span>
          <span>sui testnet</span>
        </div>
      </footer>
    </AppShell>
  );
}
