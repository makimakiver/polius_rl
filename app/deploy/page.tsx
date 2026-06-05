"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useCurrentAccount } from "@mysten/dapp-kit";
import AppShell from "../components/AppShell";
import { useWalletModal } from "../components/wallet";

const ALGOS = ["PPO", "SAC", "DQN", "Rainbow DQN", "A2C", "TD3", "Thompson Sampling"];

const fieldCls =
  "w-full border border-ink/15 bg-white/60 px-3 py-2 text-sm outline-none transition-colors focus:border-accent placeholder:text-ink/30";
const labelCls = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink/50";

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export default function DeployPage() {
  const account = useCurrentAccount();
  const { open } = useWalletModal();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [algorithm, setAlgorithm] = useState(ALGOS[0]);
  const [observation, setObservation] = useState("Box(4,)");
  const [action, setAction] = useState("Discrete(2)");
  const [lr, setLr] = useState("3e-4");
  const [gamma, setGamma] = useState("0.99");
  const [batch, setBatch] = useState("2048");
  const [tags, setTags] = useState("");
  const [deployed, setDeployed] = useState<string | null>(null);

  const id = useMemo(() => slugify(name) || "untitled-env", [name]);
  const canDeploy = name.trim().length > 1;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) {
      open();
      return;
    }
    if (!canDeploy) return;
    // Sample UI — no on-chain transaction is sent.
    setDeployed(id);
  };

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        <Link href="/" className="font-mono text-xs text-ink/50 underline-offset-4 hover:underline">
          ← dashboard
        </Link>

        <header className="mt-5 border-b border-ink/15 pb-6">
          <h1 className="text-3xl font-medium tracking-tight">Deploy a custom environment</h1>
          <p className="mt-2 max-w-2xl text-sm text-ink/60">
            Configure your reinforcement-learning environment and register it on Sui.
            Your connected wallet becomes the deployer.
          </p>
        </header>

        {/* wallet gate banner */}
        {!account && (
          <div className="mt-6 flex items-center justify-between gap-4 border border-accent/30 bg-accent/[0.06] px-4 py-3 text-sm">
            <span className="text-ink/70">Connect your Sui wallet to deploy an environment.</span>
            <button
              onClick={open}
              className="shrink-0 bg-ink px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-black"
            >
              Connect Wallet
            </button>
          </div>
        )}

        {deployed ? (
          <DeployedSuccess id={deployed} name={name} />
        ) : (
          <div className="mt-8 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
            {/* form */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-7">
              <Section title="Basics">
                <div>
                  <label className={labelCls}>Environment name</label>
                  <input
                    className={fieldCls}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. CartPole Swarm"
                  />
                  {name && (
                    <p className="mt-1 font-mono text-[11px] text-ink/40">id: {id}</p>
                  )}
                </div>
                <div>
                  <label className={labelCls}>Description</label>
                  <textarea
                    className={`${fieldCls} h-20 resize-none`}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does the agent learn in this environment?"
                  />
                </div>
              </Section>

              <Section title="Algorithm & spaces">
                <div>
                  <label className={labelCls}>Algorithm</label>
                  <select
                    className={fieldCls}
                    value={algorithm}
                    onChange={(e) => setAlgorithm(e.target.value)}
                  >
                    {ALGOS.map((a) => (
                      <option key={a} value={a}>{a}</option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={labelCls}>Observation space</label>
                    <input className={fieldCls} value={observation} onChange={(e) => setObservation(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Action space</label>
                    <input className={fieldCls} value={action} onChange={(e) => setAction(e.target.value)} />
                  </div>
                </div>
              </Section>

              <Section title="Hyperparameters">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className={labelCls}>Learning rate</label>
                    <input className={fieldCls} value={lr} onChange={(e) => setLr(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Gamma</label>
                    <input className={fieldCls} value={gamma} onChange={(e) => setGamma(e.target.value)} />
                  </div>
                  <div>
                    <label className={labelCls}>Batch size</label>
                    <input className={fieldCls} value={batch} onChange={(e) => setBatch(e.target.value)} />
                  </div>
                </div>
              </Section>

              <Section title="Tags">
                <input
                  className={fieldCls}
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="comma,separated,tags"
                />
              </Section>

              <div className="flex items-center gap-4 border-t border-ink/15 pt-6">
                <button
                  type="submit"
                  disabled={!!account && !canDeploy}
                  className="bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {account ? "Deploy environment" : "Connect to deploy"}
                </button>
                <Link href="/" className="text-sm text-ink/50 underline-offset-4 hover:underline">
                  Cancel
                </Link>
              </div>
            </form>

            {/* live preview */}
            <aside className="lg:sticky lg:top-8 lg:self-start">
              <p className={labelCls}>Preview</p>
              <div className="border border-ink/15 bg-white/40 p-4">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-medium tracking-tight">{name || "Untitled environment"}</h3>
                  <span className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ink/60">
                    <span className="h-1.5 w-1.5 rounded-full border border-ink/40" />
                    Draft
                  </span>
                </div>
                <p className="mt-2 line-clamp-3 text-sm text-ink/50">
                  {description || "Your environment description will appear here."}
                </p>
                <div className="mt-4 flex items-center justify-between border-t border-ink/10 pt-3 font-mono text-[11px] text-ink/50">
                  <span>{algorithm}</span>
                  <span>{observation} → {action}</span>
                </div>
                <div className="mt-2 font-mono text-[11px] text-ink/40">
                  by {account ? `${account.address.slice(0, 6)}…${account.address.slice(-4)}` : "— connect wallet"}
                </div>
              </div>
              <ul className="mt-4 space-y-1.5 text-xs text-ink/45">
                <li>· Settles on Sui Testnet</li>
                <li>· Hyperparameters are stored with the environment</li>
                <li>· Sample UI — no transaction is broadcast</li>
              </ul>
            </aside>
          </div>
        )}
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-mono text-xs uppercase tracking-[0.2em] text-ink/50">{title}</h2>
      {children}
    </section>
  );
}

function DeployedSuccess({ id, name }: { id: string; name: string }) {
  return (
    <div className="mt-10 border border-ink/15 bg-white/50 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </div>
      <h2 className="mt-4 text-xl font-medium tracking-tight">Environment deployed</h2>
      <p className="mt-2 text-sm text-ink/60">
        <span className="font-medium text-ink">{name || "Your environment"}</span> is registered.
      </p>
      <p className="mt-1 font-mono text-xs text-ink/40">id: {id}</p>
      <div className="mt-6 flex items-center justify-center gap-3">
        <Link href="/" className="bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-black">
          View dashboard
        </Link>
        <Link href="/deploy" className="border border-ink/15 px-5 py-2.5 text-sm transition-colors hover:border-accent">
          Deploy another
        </Link>
      </div>
    </div>
  );
}
