import AppShell from "../components/AppShell";
import EnvironmentCard from "../components/EnvironmentCard";
import DeployButton from "../components/DeployButton";
import Link from "next/link";
import { environments } from "../data/environments";

export default function EnvironmentsPage() {
  const training = environments.filter((e) => e.status === "Training").length;

  return (
    <AppShell>
      <main className="bp-grid mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/15 pb-6">
          <div>
            <p className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Marketplace
            </p>
            <h1 className="text-3xl font-medium tracking-tight">Environments</h1>
            <p className="mt-2 text-sm text-ink/60">
              Community-deployed RL environments. {training} currently training.
            </p>
          </div>
          <DeployButton>Deploy environment</DeployButton>
        </header>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {environments.map((env) => (
            <EnvironmentCard key={env.id} env={env} />
          ))}
        </div>
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
