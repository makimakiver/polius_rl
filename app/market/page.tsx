"use client";

import { useState } from "react";
import Link from "next/link";
import { useCurrentAccount } from "@mysten/dapp-kit";
import AppShell from "../components/AppShell";
import ListingCard from "../components/ListingCard";
import { LISTINGS, passPct, versionAt } from "../data/market";
import { shortAddress } from "../data/environments";

const num = new Intl.NumberFormat("en-US");

const VERIFIER_FILTERS = [
  { key: "all", label: "All" },
  { key: "onchain", label: "On-chain" },
  { key: "offchain", label: "Off-chain" },
] as const;
type VerifierFilter = (typeof VERIFIER_FILTERS)[number]["key"];

export default function MarketPage() {
  const account = useCurrentAccount();
  const [vf, setVf] = useState<VerifierFilter>("all");

  const visible = LISTINGS.filter((l) => vf === "all" || l.verifier.kind === vf);

  const totalCalls = LISTINGS.reduce((s, l) => s + l.totalCalls, 0);
  const avgPassBps =
    LISTINGS.reduce((s, l) => s + versionAt(l, l.currentVersion).passRateBps, 0) /
    LISTINGS.length;

  const stats = [
    { label: "Deployments", value: num.format(LISTINGS.length) },
    { label: "Total calls", value: num.format(totalCalls) },
    { label: "Avg pass rate", value: passPct(avgPassBps) },
    { label: "Network", value: "Sui testnet" },
  ];

  return (
    <AppShell>
      <main className="theme-agent mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        {/* header */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/25 bg-accent/[0.06] p-6">
          <div>
            <p className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Lean inference market
            </p>
            <h1 className="text-3xl font-medium tracking-tight">Your deployed inferences</h1>
            <p className="mt-2 max-w-xl font-mono text-xs text-ink/50">
              {account
                ? `owner ${shortAddress(account.address, 10, 6)}`
                : "connect a wallet to manage your deployments"}
              {" · "}post-training & deployment run automatically behind the self-play loop
            </p>
          </div>
        </header>

        {/* KPI band */}
        <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-ink/15 bg-ink/10 sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-background p-4">
              <div className="font-mono text-xl">{s.value}</div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-ink/40">
                {s.label}
              </div>
            </div>
          ))}
        </section>

        {/* listings grid */}
        <section className="mt-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-sm font-medium uppercase tracking-wide">Models</h2>
              {/* verifier selector: on-chain vs off-chain inference */}
              <div className="flex overflow-hidden rounded-md border border-ink/15">
                {VERIFIER_FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setVf(f.key)}
                    className={`px-3 py-1.5 text-xs transition-colors ${
                      vf === f.key ? "bg-accent text-white" : "text-ink/60 hover:bg-ink/[0.04]"
                    }`}
                  >
                    {f.label}
                    {f.key !== "all" && (
                      <span className="ml-1.5 opacity-60">verifier</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <span className="font-mono text-[11px] text-ink/40">click a model to preview its inference</span>
          </div>
          {visible.length === 0 ? (
            <p className="rounded-lg border border-dashed border-ink/20 p-8 text-center text-sm text-ink/50">
              No {vf !== "all" ? `${vf} ` : ""}models yet.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          )}
        </section>
      </main>

      <footer className="border-t border-ink/15 px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between font-mono text-xs text-ink/40">
          <Link href="/" className="hover:text-ink">
            ← dashboard
          </Link>
          <span>sui testnet · walrus</span>
        </div>
      </footer>
    </AppShell>
  );
}
