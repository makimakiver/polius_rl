"use client";

import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import {
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import type { Listing } from "../data/market";

/**
 * Judge0-verified run: pay on Sui (buy_inference_entry) → the served code is
 * executed in a Judge0 sandbox via MPP → the verdict is signed by the verifier
 * and recorded on-chain as a VerifiedReceipt.
 *
 * The buyer's payment Receipt id is read out of the paying transaction's object
 * changes (the created `::Receipt`) — the Python `confirm_receipt` expects an
 * object id, not a tx digest.
 */
export function VerifiedRunPanel({
  listing,
  registry,
  env,
  taskId,
  pkg,
}: {
  listing: Listing;
  registry: string;
  env: string;
  taskId: number;
  pkg: string;
}) {
  const client = useSuiClient();
  const { mutateAsync: signExec } = useSignAndExecuteTransaction();
  const [state, setState] = useState<
    "idle" | "paying" | "verifying" | "done" | "error"
  >("idle");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string>("");

  async function run() {
    setErr("");
    setResult(null);
    try {
      setState("paying");
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(listing.priceMist)]);
      tx.moveCall({
        target: `${pkg}::inference_market::buy_inference_entry`,
        arguments: [
          tx.object(registry),
          tx.object(env),
          tx.pure.u64(taskId),
          coin,
        ],
      });
      const paid = await signExec({ transaction: tx });
      setState("verifying");

      // Resolve the created `::Receipt` OBJECT id (NOT the tx digest) — the
      // verifier's confirm_receipt() reads an object id on-chain. dapp-kit's
      // sign+execute result doesn't carry object changes, so re-fetch the tx
      // block with showObjectChanges and find the created Receipt.
      await client.waitForTransaction({ digest: paid.digest });
      const block = await client.getTransactionBlock({
        digest: paid.digest,
        options: { showObjectChanges: true },
      });
      const created = block.objectChanges?.find(
        (c) =>
          c.type === "created" &&
          String(c.objectType ?? "").endsWith("::Receipt"),
      );
      const receiptId =
        created && created.type === "created" ? created.objectId : paid.digest;

      const r = await fetch("/api/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receipt_id: receiptId, task_id: taskId }),
      });
      setResult(await r.json());
      setState("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(
        /gas|balance|insufficient/i.test(msg)
          ? "No gas — fund this address from the testnet faucet."
          : msg,
      );
      setState("error");
    }
  }

  const busy = state === "paying" || state === "verifying";

  return (
    <section className="mt-6 rounded-lg border border-accent/30 bg-accent/[0.04] p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-medium uppercase tracking-wide">
          Verified run · Judge0
        </h2>
        <span className="font-mono text-[11px] text-accent">
          buy → execute in sandbox → on-chain verdict
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={run}
          disabled={busy}
          className="rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink disabled:opacity-60"
        >
          {state === "paying"
            ? "Paying…"
            : state === "verifying"
              ? "Verifying in Judge0…"
              : `Run current model · ${listing.priceSui} SUI`}
        </button>
        <span className="font-mono text-[11px] text-ink/40">
          inference_market::buy_inference_entry → MPP Judge0 (0.02 USDC) →
          record_verified_inference
        </span>
      </div>

      {result && (
        <div className="mt-5 space-y-3">
          <Verdict ok={!!result.verified} status={result.status} />
          <div className="grid gap-px overflow-hidden rounded-lg border border-ink/15 bg-ink/10 sm:grid-cols-2">
            <Row k="Pass rate" v={passPct(result.pass_bps)} />
            <Row k="Served by" v={`v${result.version}`} />
            <Row k="Judge0 token" v={result.judge0_token} mono />
            {result.usdc_pay_digest && (
              <Row
                k="USDC → MPP"
                v={result.usdc_pay_digest}
                mono
                link={`https://suiscan.xyz/testnet/tx/${result.usdc_pay_digest}`}
              />
            )}
            {result.verified_receipt_id && (
              <Row
                k="VerifiedReceipt"
                v={result.verified_receipt_id}
                mono
                link={`https://suiscan.xyz/testnet/object/${result.verified_receipt_id}`}
              />
            )}
            {result.record_digest && (
              <Row
                k="record tx"
                v={result.record_digest}
                mono
                link={`https://suiscan.xyz/testnet/tx/${result.record_digest}`}
              />
            )}
          </div>
          {result.solution && (
            <div>
              <div className="font-mono text-[10px] uppercase tracking-wide text-ink/40">
                served solution
              </div>
              <pre className="mt-1 overflow-x-auto rounded-md border border-ink/15 bg-white/60 p-3 font-mono text-[11px] leading-5 text-ink/80">
                {result.solution}
              </pre>
            </div>
          )}
        </div>
      )}

      {state === "error" && (
        <p className="mt-4 rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-600">
          {err}
        </p>
      )}
    </section>
  );
}

function passPct(bps: number | undefined): string {
  return `${((Number(bps ?? 0)) / 100).toFixed(0)}%`;
}

function Verdict({ ok, status }: { ok: boolean; status?: string }) {
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-sm ${
        ok
          ? "border-accent/40 bg-accent/[0.1] text-accent"
          : "border-rose-500/40 bg-rose-500/[0.08] text-rose-600"
      }`}
    >
      {ok ? "✓ PASS" : "✗ FAIL"}
      {status && <span className="text-ink/50">· Judge0: {status}</span>}
    </div>
  );
}

function Row({
  k,
  v,
  mono,
  link,
}: {
  k: string;
  v?: string;
  mono?: boolean;
  link?: string;
}) {
  const text = v ?? "—";
  const display = mono && text.length > 18 ? `${text.slice(0, 18)}…` : text;
  return (
    <div className="flex items-center justify-between gap-3 bg-background px-4 py-3">
      <span className="font-mono text-[11px] uppercase tracking-wide text-ink/40">
        {k}
      </span>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className={`text-accent underline-offset-4 hover:underline ${
            mono ? "break-all font-mono text-xs" : "text-sm"
          }`}
        >
          {display}
        </a>
      ) : (
        <span className={mono ? "font-mono text-xs text-ink/80" : "text-sm text-ink/80"}>
          {display}
        </span>
      )}
    </div>
  );
}
