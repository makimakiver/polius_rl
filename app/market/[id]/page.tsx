"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import AppShell from "../../components/AppShell";
import Sparkline from "../../components/Sparkline";
import { StatusDot } from "../../components/StatusPill";
import { useWalletModal } from "../../components/wallet";
import { getEnvironment } from "../../data/environments";
import VerifierPanel from "../../components/VerifierPanel";
import { useRegistry } from "../../hooks/useRegistry";
import {
  type RunResult,
  type Sample,
  getListing,
  maxVersion,
  passCurve,
  passPct,
  proves,
  runSample,
  versionAt,
} from "../../data/market";

const PKG =
  process.env.NEXT_PUBLIC_PKG_ID ??
  "0x149cff9273cd26d4c32fbf49ed38a239e5a936f37d65408e8659938d90173608";
// Set once inference_market + ModelRegistry are deployed; until then → simulated.
const REGISTRY = process.env.NEXT_PUBLIC_MARKET_REGISTRY;
const MARKET_ENV = process.env.NEXT_PUBLIC_MARKET_ENV;
const PROMOTE_MS = 6000;

export default function ListingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const listing = getListing(id);

  const client = useSuiClient();
  const account = useCurrentAccount();
  const { open } = useWalletModal();
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction();

  const [version, setVersion] = useState(listing?.currentVersion ?? 0);
  const [auto, setAuto] = useState(true);
  const [sampleIdx, setSampleIdx] = useState(0);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maxV = listing ? maxVersion(listing) : 0;
  const sample: Sample | undefined = listing?.samples[sampleIdx];

  // Background self-improvement loop (the SGS publisher advancing checkpoints).
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!auto || !listing) return;
    timer.current = setInterval(() => {
      setVersion((v) => (v >= maxV ? v : v + 1));
    }, PROMOTE_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [auto, listing, maxV]);
  useEffect(() => {
    if (version >= maxV && timer.current) clearInterval(timer.current);
  }, [version, maxV]);

  const curve = useMemo(
    () => (listing ? passCurve(listing, version) : []),
    [listing, version],
  );

  // Live read of the on-chain ModelRegistry (hook must run before any early return).
  const reg = useRegistry(REGISTRY && MARKET_ENV ? REGISTRY : undefined);

  if (!listing || !sample) {
    return (
      <AppShell>
        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
          <p className="rounded-lg border border-dashed border-ink/20 p-8 text-center text-sm text-ink/50">
            Unknown model. <Link href="/market" className="text-accent underline-offset-4 hover:underline">Back to market →</Link>
          </p>
        </main>
      </AppShell>
    );
  }

  const model = versionAt(listing, version);
  // Real on-chain run only for the listing that has a deployed registry+env.
  const onChain = !!(REGISTRY && MARKET_ENV && listing.real);
  // Free preview of what the current version produces for this sample, shown on
  // load (no wallet needed). Recomputes as the loop promotes → flips ✗ → ✓ live.
  const preview = runSample(listing, sample, version);
  const shown = result ?? preview;

  const run = async () => {
    if (!account) return open();
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      let txDigest: string | undefined;
      if (onChain) {
        const tx = new Transaction();
        const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(listing.priceMist)]);
        tx.moveCall({
          target: `${PKG}::inference_market::buy_inference_entry`,
          arguments: [
            tx.object(REGISTRY!),
            tx.object(MARKET_ENV!),
            tx.pure.u64(sampleIdx),
            coin,
          ],
        });
        const { digest } = await signAndExecute({ transaction: tx });
        await client.waitForTransaction({ digest });
        txDigest = digest;
      } else {
        await new Promise((r) => setTimeout(r, 700));
      }
      setResult(runSample(listing, sample, version, txDigest));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/gas|balance|insufficient/i.test(msg) ? "No gas — fund this address from the testnet faucet." : msg);
    } finally {
      setRunning(false);
    }
  };

  return (
    <AppShell>
      <main className="theme-agent mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        <Link href="/market" className="font-mono text-[11px] text-ink/40 hover:text-ink">
          ← all deployments
        </Link>

        {/* header */}
        <header className="mt-3 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/25 bg-accent/[0.06] p-6">
          <div>
            <p className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {listing.task}
            </p>
            <h1 className="font-mono text-2xl font-medium tracking-tight">{listing.modelName}</h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 font-mono text-xs text-ink/50">
              <span>deployed {listing.deployedAt} · {listing.totalCalls.toLocaleString()} calls · {listing.priceSui} SUI / call</span>
              <Link
                href="/environments"
                className="rounded-full border border-accent/30 bg-accent/[0.08] px-2 py-0.5 text-accent hover:bg-accent/[0.14]"
              >
                env: {getEnvironment(listing.environmentId)?.name ?? listing.environmentId} ↗
              </Link>
              {listing.real && (
                <span className="rounded-full border border-ink/15 px-2 py-0.5 text-ink/50">
                  real · SGS-trained
                </span>
              )}
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-wide text-ink/40">current model</div>
            <div className="font-mono text-2xl">v{model.v}</div>
            <div className="font-mono text-sm text-accent">{passPct(model.passRateBps)} pass</div>
          </div>
        </header>

        <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          {/* left: sample inference */}
          <section className="rounded-lg border border-ink/15 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wide">Sample inference</h2>
              <StatusDot label={onChain ? "on-chain" : "simulated"} dotClass={onChain ? "bg-accent" : "bg-ink/40"} />
            </div>

            {/* sample picker (fixed prompts, no free-form input) */}
            {listing.samples.length > 1 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {listing.samples.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setSampleIdx(i);
                      setResult(null);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
                      i === sampleIdx
                        ? "border-accent bg-accent/[0.1] text-ink"
                        : "border-ink/15 text-ink/60 hover:bg-ink/[0.04]"
                    }`}
                  >
                    sample {i + 1}
                    <span className="ml-1.5 text-ink/35">{proves(version, s) ? "✓" : "✗"}</span>
                  </button>
                ))}
              </div>
            )}

            <div className="font-mono text-[10px] uppercase tracking-wide text-ink/40">input</div>
            <pre className="mt-1 overflow-x-auto rounded-md border border-ink/15 bg-white/60 p-3 font-mono text-xs leading-5 text-ink/80">
              {sample.input}
            </pre>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                onClick={run}
                disabled={running}
                className="rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink disabled:opacity-60"
              >
                {running ? "Running…" : account ? `Run · ${listing.priceSui} SUI` : "Connect to run"}
              </button>
              <span className="font-mono text-[11px] text-ink/40">
                {onChain ? "inference_market::buy_inference_entry" : "simulated (no on-chain registry for this model)"}
              </span>
            </div>

            {/* output — preview on load (free), live result after a paid run */}
            <div className={`mt-5 rounded-md border p-4 ${shown.verified ? "border-accent/30 bg-accent/[0.06]" : "border-rose-500/30 bg-rose-500/[0.06]"}`}>
              <div className="flex items-center justify-between">
                <p className={`text-sm font-medium ${shown.verified ? "text-ink/80" : "text-rose-600"}`}>
                  {shown.verified ? "✓ Verified output" : "✗ Rejected by verifier"}
                </p>
                <span className="font-mono text-[11px] text-ink/50">
                  {result ? "served" : "preview"} · v{shown.version} · {passPct(shown.passRateBps)}
                </span>
              </div>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-wide text-ink/40">output</div>
              <pre className="mt-1 overflow-x-auto font-mono text-xs leading-5 text-ink/80">{shown.output}</pre>
              <div className="mt-3 flex flex-wrap gap-3 font-mono text-[11px]">
                <a href={`https://walruscan.com/testnet/blob/${shown.attestationBlobId}`} target="_blank" rel="noopener noreferrer" className="text-accent underline-offset-4 hover:underline">
                  attestation on Walrus ↗
                </a>
                {result?.txDigest && (
                  <a href={`https://suiscan.xyz/testnet/tx/${result.txDigest}`} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline-offset-4 hover:underline">
                    payment tx ↗
                  </a>
                )}
              </div>
              {!shown.verified && (
                <p className="mt-2 text-[11px] text-ink/50">v{shown.version} can&apos;t solve this yet — promote checkpoints (or wait for the loop) and it flips to ✓.</p>
              )}
            </div>
            {error && (
              <p className="mt-4 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-600">{error}</p>
            )}

            {/* SPG-generated training data tied to the environment */}
            {listing.spgProblems && listing.spgProblems.length > 0 && (
              <div className="mt-6">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-mono text-[11px] uppercase tracking-wide text-ink/50">
                    SPG-generated training problems
                  </h3>
                  <span className="font-mono text-[10px] text-ink/35">Lean-admitted · from failures</span>
                </div>
                <div className="space-y-1.5">
                  {listing.spgProblems.map((p, i) => (
                    <pre key={i} className="overflow-x-auto rounded-md border border-ink/15 bg-white/60 p-2.5 font-mono text-[11px] leading-5 text-ink/70">
                      {p.trim()}
                    </pre>
                  ))}
                </div>
                <p className="mt-2 font-mono text-[10px] text-ink/40">
                  the conjecturer (g_φ) mined these from solver failures on the environment; the solver post-trains on them.
                </p>
              </div>
            )}
          </section>

          {/* right: self-improvement */}
          <section className="rounded-lg border border-ink/15 p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wide">Self-improvement</h2>
              <StatusDot label={auto && version < maxV ? "training" : "idle"} dotClass={auto && version < maxV ? "bg-accent" : "bg-ink/40"} />
            </div>
            <Sparkline data={curve.length > 1 ? curve : [...curve, ...curve]} height={120} className="text-accent" />
            <p className="mt-2 font-mono text-[11px] text-ink/50">verifier pass rate per published checkpoint (Walrus LoRA adapters)</p>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button onClick={() => setAuto((a) => !a)} className="rounded-md border border-ink/15 px-3 py-1.5 text-xs text-ink/70 transition-colors hover:bg-ink/[0.04]">
                {auto ? "Pause loop" : "Resume loop"}
              </button>
              <button onClick={() => setVersion((v) => Math.min(maxV, v + 1))} disabled={version >= maxV} className="rounded-md border border-ink/15 px-3 py-1.5 text-xs text-ink/70 transition-colors hover:bg-ink/[0.04] disabled:opacity-40">
                Promote next checkpoint
              </button>
              <button onClick={() => { setVersion(0); setResult(null); }} className="rounded-md border border-ink/15 px-3 py-1.5 text-xs text-ink/70 transition-colors hover:bg-ink/[0.04]">
                Reset to v0
              </button>
            </div>

            <div className="mt-5 space-y-1.5">
              {listing.versions.map((m) => {
                const isCur = m.v === version;
                const published = m.v <= version;
                return (
                  <div key={m.v} className={`flex items-center justify-between rounded-md border px-3 py-2 font-mono text-[11px] ${isCur ? "border-accent/40 bg-accent/[0.06]" : published ? "border-ink/15" : "border-dashed border-ink/15 opacity-40"}`}>
                    <span className="flex items-center gap-2">
                      <span className={`h-1.5 w-1.5 rounded-full ${isCur ? "bg-accent" : published ? "bg-ink/40" : "bg-transparent border border-ink/30"}`} />
                      v{m.v} {isCur && <span className="text-accent">· current</span>}
                    </span>
                    <span className="text-ink/60">{passPct(m.passRateBps)}</span>
                    <span className="text-ink/35">{proves(m.v, sample) ? "solves ✓" : "fails ✗"}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {onChain && reg.data && (
          <section className="mt-6 rounded-lg border border-accent/30 bg-accent/[0.04] p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium uppercase tracking-wide">Live on-chain registry</h2>
              <span className="font-mono text-[11px] text-accent">Sui testnet · refetch 5s</span>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-ink/15 bg-ink/10 sm:grid-cols-4">
              {[
                { label: "Current best", value: `v${reg.data.currentBest}` },
                { label: "Total calls", value: `${reg.data.totalCalls}` },
                { label: "Fee pool", value: `${(reg.data.feePoolMist / 1e9).toFixed(4)} SUI` },
                { label: "Checkpoints", value: `${reg.data.versions.length}` },
              ].map((s) => (
                <div key={s.label} className="bg-background p-4">
                  <div className="font-mono text-xl">{s.value}</div>
                  <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-ink/40">{s.label}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              {reg.data.versions.map((v, i) => (
                <div key={i} className="flex items-center justify-between rounded-md border border-ink/15 px-3 py-2 font-mono text-[11px]">
                  <span className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 rounded-full ${i === reg.data?.currentBest ? "bg-accent" : "bg-ink/40"}`} />
                    v{i} {i === reg.data?.currentBest && <span className="text-accent">· current</span>}
                  </span>
                  <span className="text-ink/60">{(v.passRateBps / 100).toFixed(0)}% pass</span>
                  <a
                    href={`https://walruscan.com/testnet/blob/${v.blobId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="max-w-[42%] truncate text-accent underline-offset-4 hover:underline"
                  >
                    {v.blobId.slice(0, 14)}… ↗
                  </a>
                </div>
              ))}
            </div>
            <p className="mt-2 font-mono text-[10px] text-ink/40">
              read live from ModelRegistry {REGISTRY?.slice(0, 12)}… — versions are LoRA adapter blobs on Walrus
            </p>
          </section>
        )}

        <VerifierPanel
          verifier={listing.verifier}
          envName={getEnvironment(listing.environmentId)?.name ?? listing.environmentId}
        />
      </main>

      <footer className="border-t border-ink/15 px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between font-mono text-xs text-ink/40">
          <Link href="/market" className="hover:text-ink">← market</Link>
          <span>sui testnet · walrus</span>
        </div>
      </footer>
    </AppShell>
  );
}
