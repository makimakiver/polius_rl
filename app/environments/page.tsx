"use client";

import { useState } from "react";
import Link from "next/link";
import AppShell from "../components/AppShell";
import EnvironmentCard from "../components/EnvironmentCard";
import OnchainEnvCard from "../components/OnchainEnvCard";
import DeployButton from "../components/DeployButton";
import { environments } from "../data/environments";
import { useOnchainEnvironments } from "../hooks/useOnchainEnvironments";

const SOURCES = [
  { key: "onchain", label: "On-chain (live)" },
  { key: "offchain", label: "Off-chain (curated)" },
] as const;
type Source = (typeof SOURCES)[number]["key"];

export default function EnvironmentsPage() {
  const [source, setSource] = useState<Source>("onchain");
  const training = environments.filter((e) => e.status === "Training").length;

  const { data: onchain, isLoading } = useOnchainEnvironments();

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
            <p className="mt-2 max-w-xl text-sm text-ink/60">
              {source === "offchain"
                ? `Curated sample environments — illustrative reward curves and stats. ${training} marked training.`
                : "Live, Walrus-backed environments, on-chain-verifiable via Nautilus."}
            </p>
          </div>
          <DeployButton>Deploy environment</DeployButton>
        </header>

        {/* off-chain / on-chain toggle */}
        <div className="mt-6 flex w-max overflow-hidden rounded-md border border-ink/15">
          {SOURCES.map((s) => (
            <button
              key={s.key}
              onClick={() => setSource(s.key)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                source === s.key
                  ? "bg-accent text-white"
                  : "text-ink/60 hover:bg-ink/[0.04]"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {source === "offchain" ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {environments.map((env) => (
              <EnvironmentCard key={env.id} env={env} />
            ))}
          </div>
        ) : isLoading ? (
          <p className="mt-8 rounded-lg border border-dashed border-ink/20 p-8 text-center font-mono text-sm text-ink/50">
            reading on-chain environments…
          </p>
        ) : !onchain || onchain.length === 0 ? (
          <p className="mt-8 rounded-lg border border-dashed border-ink/20 p-8 text-center text-sm text-ink/50">
            No on-chain environments yet — deploy one with{" "}
            <code className="font-mono text-ink/70">
              npx tsx scripts/pollius-env.ts deploy &lt;dir&gt;
            </code>{" "}
            or the{" "}
            <Link href="/environments/deploy" className="text-accent hover:underline">
              Deploy Env page
            </Link>
            .
          </p>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {onchain.map((env) => (
              <OnchainEnvCard key={env.id} env={env} />
            ))}
          </div>
        )}
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
