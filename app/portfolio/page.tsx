"use client";

import { useState } from "react";
import Link from "next/link";
import { useCurrentAccount, useSuiClientQuery } from "@mysten/dapp-kit";
import AppShell from "../components/AppShell";
import { StatusDot } from "../components/StatusPill";
import { useWalletModal } from "../components/wallet";
import { shortAddress } from "../data/environments";

const PKG =
  process.env.NEXT_PUBLIC_PKG_ID ??
  "0x149cff9273cd26d4c32fbf49ed38a239e5a936f37d65408e8659938d90173608";

const num = new Intl.NumberFormat("en-US");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ObjFields = Record<string, any>;

interface Position {
  objectId: string;
  type: string;
  fields: ObjFields;
}

function passPct(bps: unknown): string {
  return `${(Number(bps ?? 0) / 100).toFixed(0)}%`;
}

export default function PortfolioPage() {
  const account = useCurrentAccount();
  const { open } = useWalletModal();

  const owned = useSuiClientQuery(
    "getOwnedObjects",
    {
      owner: account?.address ?? "",
      filter: { MoveModule: { package: PKG, module: "inference_market" } },
      options: { showContent: true, showType: true },
    },
    { enabled: !!account, refetchInterval: 8000 },
  );

  const positions: Position[] = (owned.data?.data ?? [])
    .map((o) => {
      const content = o.data?.content;
      if (!content || content.dataType !== "moveObject") return null;
      return {
        objectId: o.data?.objectId ?? "",
        type: content.type,
        fields: (content.fields ?? {}) as ObjFields,
      };
    })
    .filter((p): p is Position => !!p && !!p.objectId);

  const verified = positions.filter((p) => p.type.endsWith("::VerifiedReceipt"));
  const receipts = positions.filter((p) => p.type.endsWith("::Receipt"));

  return (
    <AppShell>
      <main className="theme-agent mx-auto w-full max-w-6xl flex-1 px-5 py-8 sm:px-8">
        {/* header */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent/25 bg-accent/[0.06] p-6">
          <div>
            <p className="mb-1 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Inference positions
            </p>
            <h1 className="text-3xl font-medium tracking-tight">Portfolio</h1>
            <p className="mt-2 max-w-xl font-mono text-xs text-ink/50">
              {account
                ? `owner ${shortAddress(account.address, 10, 6)}`
                : "connect a wallet to see your Receipt / VerifiedReceipt positions"}
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] uppercase tracking-wide text-ink/40">
              positions
            </div>
            <div className="font-mono text-2xl tabular-nums">
              {num.format(positions.length)}
            </div>
          </div>
        </header>

        {/* KPI band */}
        <section className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-ink/15 bg-ink/10 sm:grid-cols-3">
          {[
            { label: "Verified receipts", value: num.format(verified.length) },
            { label: "Payment receipts", value: num.format(receipts.length) },
            {
              label: "Pass verdicts",
              value: num.format(
                verified.filter((v) => Number(v.fields.pass_bps ?? 0) >= 10000).length,
              ),
            },
          ].map((s) => (
            <div key={s.label} className="bg-background p-4">
              <div className="font-mono text-xl tabular-nums">{s.value}</div>
              <div className="mt-1 font-mono text-[11px] uppercase tracking-wide text-ink/40">
                {s.label}
              </div>
            </div>
          ))}
        </section>

        {!account ? (
          <section className="mt-6">
            <button
              onClick={open}
              className="rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink"
            >
              Connect wallet
            </button>
          </section>
        ) : owned.isLoading ? (
          <p className="mt-6 rounded-lg border border-dashed border-ink/20 p-8 text-center text-sm text-ink/50">
            Reading owned objects…
          </p>
        ) : positions.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-ink/20 p-8 text-center text-sm text-ink/50">
            No positions yet —{" "}
            <Link
              href="/market"
              className="text-accent underline-offset-4 hover:underline"
            >
              buy an inference →
            </Link>
          </p>
        ) : (
          <>
            {/* VerifiedReceipts */}
            <section className="mt-6">
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-sm font-medium uppercase tracking-wide">
                  Verified receipts
                </h2>
                <span className="font-mono text-[11px] text-ink/40">
                  Judge0 verdicts attested on Sui
                </span>
              </div>
              {verified.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink/20 p-6 text-center text-sm text-ink/50">
                  No verified receipts yet.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {verified.map((p) => (
                    <VerifiedCard key={p.objectId} pos={p} />
                  ))}
                </div>
              )}
            </section>

            {/* Payment Receipts */}
            <section className="mt-8">
              <div className="mb-3 flex items-center gap-3">
                <h2 className="text-sm font-medium uppercase tracking-wide">
                  Payment receipts
                </h2>
                <span className="font-mono text-[11px] text-ink/40">
                  proof of a paid inference call
                </span>
              </div>
              {receipts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-ink/20 p-6 text-center text-sm text-ink/50">
                  No payment receipts.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {receipts.map((p) => (
                    <ReceiptCard key={p.objectId} pos={p} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <footer className="border-t border-ink/15 px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-6xl items-center justify-between font-mono text-xs text-ink/40">
          <Link href="/market" className="hover:text-ink">
            ← market
          </Link>
          <span>sui testnet · walrus</span>
        </div>
      </footer>
    </AppShell>
  );
}

function VerifiedCard({ pos }: { pos: Position }) {
  const f = pos.fields;
  const passed = Number(f.pass_bps ?? 0) >= 10000;
  const token = String(f.judge0_token ?? "");
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex flex-col rounded-lg border border-ink/15 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-medium">
            task #{String(f.task_id ?? "?")}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink/45">
            VerifiedReceipt · v{String(f.version ?? 0)}
          </div>
        </div>
        <StatusDot
          label={passed ? "PASS" : "FAIL"}
          dotClass={passed ? "bg-accent" : "bg-rose-500"}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 font-mono text-[11px]">
        <div>
          <div className={`text-base tabular-nums ${passed ? "text-accent" : "text-rose-600"}`}>
            {passPct(f.pass_bps)}
          </div>
          <div className="text-ink/40">pass rate</div>
        </div>
        <div>
          <div className="text-base tabular-nums">v{String(f.version ?? 0)}</div>
          <div className="text-ink/40">version</div>
        </div>
        <div>
          <div className={`text-base ${passed ? "text-accent" : "text-rose-600"}`}>
            {passed ? "✓" : "✗"}
          </div>
          <div className="text-ink/40">verdict</div>
        </div>
      </div>

      {/* re-verify in Judge0: surface the stored token to re-run / copy */}
      <div className="mt-4 rounded-md border border-ink/15 bg-white/60 p-3">
        <div className="font-mono text-[10px] uppercase tracking-wide text-ink/40">
          judge0 token
        </div>
        <div className="mt-1 break-all font-mono text-[11px] text-ink/70">
          {token || "—"}
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (!token) return;
              navigator.clipboard?.writeText(token);
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            disabled={!token}
            className="rounded-md border border-ink/15 px-2.5 py-1 font-mono text-[10px] text-ink/70 transition-colors hover:bg-ink/[0.04] disabled:opacity-40"
          >
            {copied ? "copied" : "copy token"}
          </button>
          <a
            href={`https://mpp.t2000.ai/judge0/v1/submissions/${token}`}
            target="_blank"
            rel="noopener noreferrer"
            className={`rounded-md border border-accent/30 bg-accent/[0.08] px-2.5 py-1 font-mono text-[10px] text-accent transition-colors hover:bg-accent/[0.14] ${
              token ? "" : "pointer-events-none opacity-40"
            }`}
          >
            re-verify in Judge0 ↗
          </a>
        </div>
      </div>

      <a
        href={`https://suiscan.xyz/testnet/object/${pos.objectId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 border-t border-ink/10 pt-3 font-mono text-[11px] text-accent underline-offset-4 hover:underline"
      >
        {pos.objectId.slice(0, 14)}… ↗
      </a>
    </div>
  );
}

function ReceiptCard({ pos }: { pos: Position }) {
  const f = pos.fields;
  return (
    <div className="flex flex-col rounded-lg border border-ink/15 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-sm font-medium">
            task #{String(f.theorem_id ?? f.task_id ?? "?")}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-ink/45">
            Receipt · v{String(f.version ?? 0)}
          </div>
        </div>
        <StatusDot label="paid" dotClass="bg-ink/40" />
      </div>
      <a
        href={`https://suiscan.xyz/testnet/object/${pos.objectId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 border-t border-ink/10 pt-3 font-mono text-[11px] text-accent underline-offset-4 hover:underline"
      >
        {pos.objectId.slice(0, 14)}… ↗
      </a>
    </div>
  );
}
