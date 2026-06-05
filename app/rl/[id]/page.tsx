import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import AppShell from "../../components/AppShell";
import TrainingPanel from "../../components/TrainingPanel";
import { environments, getEnvironment, shortAddress } from "../../data/environments";
import { agentsInEnvironment } from "../../data/agents";

// Pre-render a static page per known environment.
export function generateStaticParams() {
  return environments.map((env) => ({ id: env.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const env = getEnvironment(id);
  return {
    title: env ? `${env.name} — pollius rl` : "environment — pollius rl",
  };
}

export default async function RlEnvironmentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const env = getEnvironment(id);

  if (!env) notFound();

  const joinedAgents = agentsInEnvironment(env.id);

  return (
    <AppShell>
      <main className="bp-grid mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        <Link
          href="/"
          className="font-mono text-xs text-ink/50 underline-offset-4 hover:underline"
        >
          ← environments
        </Link>

        {/* Header */}
        <header className="mt-5 border-b border-ink/15 pb-7">
          <p className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            RL Environment
          </p>
          <div className="flex items-center gap-2 font-mono text-[11px] text-ink/50">
            <span className="border border-ink/20 px-1.5 py-0.5">{env.algorithm}</span>
            {env.tags.map((t) => (
              <span key={t} className="border border-ink/20 px-1.5 py-0.5">
                {t}
              </span>
            ))}
          </div>
          <h1 className="mt-3 text-3xl font-medium tracking-tight">{env.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink/60">{env.description}</p>
          <div className="mt-3 font-mono text-xs text-ink/40">
            deployed by {shortAddress(env.deployer, 10, 6)}
          </div>
        </header>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <TrainingPanel env={env} />

          <div className="flex flex-col gap-6">
            <section className="border border-ink/15 p-5">
              <h2 className="text-sm font-medium uppercase tracking-wide">Spec</h2>
              <dl className="mt-4 space-y-2.5 text-sm">
                <SpecRow label="algorithm" value={env.algorithm} />
                <SpecRow label="observation" value={env.observationSpace} />
                <SpecRow label="action" value={env.actionSpace} />
                <SpecRow label="id" value={env.id} />
              </dl>
            </section>

            <section className="border border-ink/15 p-5">
              <h2 className="text-sm font-medium uppercase tracking-wide">Hyperparameters</h2>
              <dl className="mt-4 grid grid-cols-2 gap-px border border-ink/15 bg-ink/15">
                {env.hyperparameters.map((h) => (
                  <div key={h.label} className="bg-background p-3">
                    <dt className="font-mono text-[11px] uppercase tracking-wide text-ink/40">
                      {h.label}
                    </dt>
                    <dd className="mt-0.5 font-mono text-sm">{h.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>

        {/* Agents that joined this environment */}
        <section className="theme-agent mt-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-ink/50">
              Agents in this environment
            </h2>
            <span className="font-mono text-xs text-ink/40">{joinedAgents.length}</span>
          </div>

          {joinedAgents.length === 0 ? (
            <p className="border border-dashed border-ink/20 p-6 text-center text-sm text-ink/50">
              No agents have joined yet.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {joinedAgents.map((a) => {
                const tone =
                  a.status === "Active" ? "bg-accent" : a.status === "Training" ? "bg-ink" : "bg-transparent border border-ink/40";
                return (
                  <Link
                    key={a.id}
                    href="/agents"
                    className="group flex items-center gap-3 rounded-lg border border-ink/15 bg-white/50 p-3 shadow-sm transition-colors hover:border-accent"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-background">
                      {a.name.split("-")[1]?.[0] ?? "H"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium group-hover:text-accent">{a.name}</div>
                      <div className="font-mono text-[11px] text-ink/40">
                        {a.model} · {a.envIds.length} env{a.envIds.length > 1 ? "s" : ""}
                      </div>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink/60">
                      <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
                      {a.status}
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-ink/15 px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between font-mono text-xs text-ink/40">
          <Link href="/" className="hover:text-ink">← back</Link>
          <span>sui testnet</span>
        </div>
      </footer>
    </AppShell>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-ink/10 pb-2.5 last:border-0 last:pb-0">
      <dt className="font-mono text-[11px] uppercase tracking-wide text-ink/40">{label}</dt>
      <dd className="font-mono text-xs">{value}</dd>
    </div>
  );
}
