"use client";

import { useState } from "react";
import Link from "next/link";
import { useCurrentAccount } from "@mysten/dapp-kit";
import AppShell from "../../components/AppShell";
import { useWalletModal } from "../../components/wallet";
import { shortAddress } from "../../data/environments";
import { agentFromClaims, addCustomAgent, type VerifiedClaims } from "../../data/customAgents";

const fieldCls =
  "w-full border border-ink/15 bg-white/60 px-3 py-2 text-sm outline-none transition-colors focus:border-accent placeholder:text-ink/30";
const labelCls = "mb-1.5 block text-xs font-medium uppercase tracking-wide text-ink/50";

type Status = "idle" | "verifying" | "verified" | "issued" | "error";

export default function RegisterAgentFlow({ initialToken = "" }: { initialToken?: string }) {
  const account = useCurrentAccount();
  const { open } = useWalletModal();

  const [token, setToken] = useState(initialToken);
  const [status, setStatus] = useState<Status>("idle");
  const [claims, setClaims] = useState<VerifiedClaims | null>(null);
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function verify() {
    if (!account) return open();
    if (!token.trim()) return;
    setStatus("verifying");
    setError(null);
    setClaims(null);
    try {
      const r = await fetch("/api/verify-token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: token.trim(), connected_address: account.address }),
      });
      const json = await r.json();
      if (!r.ok || !json.verified) {
        setError(json.error ?? "verification failed");
        setStatus("error");
        return;
      }
      setClaims({
        agent_name: json.agent_name,
        address: json.address,
        role: json.role,
        description: json.description,
      });
      setStatus("verified");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }

  function issueIdentity() {
    if (!claims) return;
    const agent = agentFromClaims(claims);
    addCustomAgent(agent);
    setIdentityId(agent.identityId ?? null);
    setStatus("issued");
  }

  const verifyDisabled = !!account && (!token.trim() || status === "verifying");

  return (
    <AppShell>
      <main className="theme-agent mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:px-8">
        <p className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Agent identity
        </p>
        <h1 className="text-3xl font-medium tracking-tight">Register a new agent</h1>
        <p className="mt-2 max-w-xl text-sm leading-6 text-ink/60">
          Verify your agent&apos;s registration token to issue its soulbound identity. The
          identity is bound to your wallet and cannot be transferred.
        </p>

        {/* Step 1 — token */}
        <section className="mt-8 rounded-xl border border-ink/15 p-5">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-ink/50">1 · Registration token</h2>
          <label className={labelCls} htmlFor="token">Token</label>
          <textarea
            id="token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            rows={3}
            placeholder="paste the registration token issued to your agent"
            className={`${fieldCls} font-mono`}
          />
        </section>

        {/* Step 2 — wallet + verify */}
        <section className="mt-5 rounded-xl border border-ink/15 p-5">
          <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-ink/50">2 · Verify with wallet</h2>
          <p className="font-mono text-xs text-ink/50">
            {account ? `connected ${shortAddress(account.address, 10, 6)}` : "connect a wallet to verify"}
          </p>
          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={verify}
              disabled={verifyDisabled}
              className="rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            >
              {status === "verifying" ? "Verifying…" : account ? "Verify token" : "Connect wallet"}
            </button>
            {status === "error" && <span className="text-xs text-rose-600">⚠ {error}</span>}
          </div>
        </section>

        {/* Verified profile */}
        {(status === "verified" || status === "issued") && claims && (
          <section className="mt-5 rounded-xl border border-accent/30 bg-accent/[0.06] p-5">
            <h2 className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-accent">✓ Verified agent</h2>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <Row label="name" value={`${claims.agent_name}.polius.sui`} />
              <Row label="role" value={claims.role} />
              <Row label="owner" value={shortAddress(claims.address, 10, 6)} mono />
              <Row label="description" value={claims.description} />
            </dl>
            {status === "verified" && (
              <button
                type="button"
                onClick={issueIdentity}
                className="mt-5 rounded-full bg-accent px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                Issue identity
              </button>
            )}
          </section>
        )}

        {/* Issued */}
        {status === "issued" && identityId && (
          <section className="mt-5 rounded-xl border border-ink/15 p-5">
            <h2 className="mb-2 font-mono text-xs uppercase tracking-[0.2em] text-ink/50">Identity issued</h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-accent/40 bg-accent/10 px-3 py-1 font-mono text-xs text-accent">
                {identityId}
              </span>
              <span className="font-mono text-[11px] uppercase tracking-wide text-ink/40">soulbound · non-transferable</span>
            </div>
            <Link href="/agents" className="mt-5 inline-block text-sm text-accent underline-offset-4 hover:underline">
              View in agents →
            </Link>
          </section>
        )}
      </main>
    </AppShell>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wide text-ink/40">{label}</dt>
      <dd className={`${mono ? "font-mono " : ""}text-ink/80`}>{value}</dd>
    </div>
  );
}
