"use client";

import { useState } from "react";
import {
  useCurrentAccount,
  useCurrentWallet,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { isEnokiWallet } from "@mysten/enoki";
import { Transaction } from "@mysten/sui/transactions";
import { useWalletModal } from "./wallet";

/**
 * Demo: execute a Move call from the frontend. The SAME code path works for
 * both zkLogin (Enoki / "Sign in with Google") and normal wallets (Slush, …)
 * because Enoki wallets are registered as wallet-standard wallets in dapp-kit.
 */

const PKG =
  process.env.NEXT_PUBLIC_PKG_ID ??
  "0x7b65a4b95f21702c38289dd417bdb14bd20f4abfcd4ddf72a52ac83db482e844";
const CLOCK = "0x6"; // shared system Clock object

function truncate(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export default function ContractDemo() {
  const client = useSuiClient();
  const account = useCurrentAccount();
  const { currentWallet } = useCurrentWallet();
  const { open } = useWalletModal();
  const { mutate: signAndExecute, isPending } = useSignAndExecuteTransaction();

  const [digest, setDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isZkLogin = currentWallet ? isEnokiWallet(currentWallet) : false;

  const run = () => {
    if (!account) {
      open(); // not connected → open the connect modal
      return;
    }
    setDigest(null);
    setError(null);

    const tx = new Transaction();
    // create_world_entry(name, description, tags, artifact_uri,
    //   decay_bps_per_day, floor, ceil, init_value, clock, ctx)
    // One-click demo with placeholder metadata. The real registry form lives
    // on /deploy.
    tx.moveCall({
      target: `${PKG}::environment::create_world_entry`,
      arguments: [
        tx.pure.string("demo-env"), // name
        tx.pure.string("one-click contract demo"), // description
        tx.pure.vector("string", ["demo"]), // tags
        tx.pure.string(""), // artifact_uri
        tx.pure.u64(100), // decay_bps_per_day
        tx.pure.u64(0), // floor
        tx.pure.u64(1000), // ceil
        tx.pure.u64(500), // init_value
        tx.object(CLOCK), // &Clock
      ],
    });

    // After you republish the package, swap the call above for the no-op:
    //   tx.moveCall({ target: `${PKG}::environment::ping` });

    signAndExecute(
      { transaction: tx },
      {
        onSuccess: async ({ digest }) => {
          setDigest(digest);
          // Wait for finality so the explorer link resolves immediately.
          await client.waitForTransaction({ digest });
        },
        onError: (e) => {
          console.error("[demo] tx failed:", e);
          const msg = e instanceof Error ? e.message : String(e);
          setError(
            /gas|balance|insufficient/i.test(msg)
              ? "No gas — this address has 0 SUI. Fund it from the testnet faucet, or wire up Enoki sponsored transactions."
              : msg,
          );
        },
      },
    );
  };

  return (
    <section className="mt-10 border border-ink/15 p-6">
      <div className="mb-1 flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        <h2 className="font-mono text-xs uppercase tracking-[0.25em] text-ink/50">
          Smart contract demo
        </h2>
      </div>
      <p className="mt-2 max-w-xl text-sm leading-6 text-ink/60">
        Execute a Move call on the published package. The same button works whether
        you signed in with <span className="font-medium text-ink/80">Google (zkLogin)</span> or
        connected a wallet like <span className="font-medium text-ink/80">Slush</span>.
      </p>

      {/* connection status */}
      <div className="mt-4 flex flex-wrap items-center gap-2 font-mono text-[11px]">
        {account ? (
          <>
            <span className="inline-flex items-center gap-1.5 border border-ink/15 px-2 py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              {isZkLogin ? "zkLogin" : currentWallet?.name ?? "wallet"}
            </span>
            <span className="border border-ink/15 px-2 py-1 text-ink/60">
              {truncate(account.address)}
            </span>
          </>
        ) : (
          <span className="border border-dashed border-ink/25 px-2 py-1 text-ink/50">
            not connected
          </span>
        )}
      </div>

      {/* action */}
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={isPending}
          className="bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-black disabled:opacity-60"
        >
          {isPending ? "Executing…" : account ? "Run demo transaction" : "Connect a wallet"}
        </button>
        <span className="font-mono text-[11px] text-ink/40">
          {PKG.slice(0, 10)}…::environment::create_world_entry
        </span>
      </div>

      {/* result */}
      {digest && (
        <div className="mt-4 border border-accent/30 bg-accent/[0.06] px-4 py-3 text-sm">
          <p className="font-medium text-ink/80">✓ Transaction executed</p>
          <a
            href={`https://suiscan.xyz/testnet/tx/${digest}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block break-all font-mono text-xs text-accent underline-offset-4 hover:underline"
          >
            {digest} ↗
          </a>
        </div>
      )}
      {error && (
        <p className="mt-4 border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-600">
          {error}
        </p>
      )}
    </section>
  );
}
