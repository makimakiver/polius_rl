"use client";

import { useState } from "react";
import Link from "next/link";
import {
  useCurrentAccount,
  useSignAndExecuteTransaction,
  useSuiClient,
} from "@mysten/dapp-kit";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";
import AppShell from "../components/AppShell";
import { useWalletModal } from "../components/wallet";
import { fieldCls, labelCls } from "../components/ui";

const PKG =
  process.env.NEXT_PUBLIC_PKG_ID ??
  "0x149cff9273cd26d4c32fbf49ed38a239e5a936f37d65408e8659938d90173608";

const NET = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet";

const scanObject = (id: string) => `https://suiscan.xyz/${NET}/object/${id}`;
const scanTx = (digest: string) => `https://suiscan.xyz/${NET}/tx/${digest}`;

const DATASET_PLACEHOLDER = `[
  { "question": "Sort the list [3, 1, 2] ascending.", "answer": "[1, 2, 3]" },
  { "question": "Sort the list [9, 4, 7] ascending.", "answer": "[4, 7, 9]" }
]

— or JSONL, one {"question","answer"} object per line.
Leave blank to use the default sort-list task set.`;

type DeployResult = {
  n_tasks: number;
  dataset_hash: string;
  artifact_uri: string;
};

type VerifyResult = {
  env: string;
  model: string;
  n_samples: number;
  mean_reward_bps: number;
  pass_bps: number;
  dataset_hash: string;
  intent: number;
  timestamp_ms: number;
  attester_pk: string;
  signature: string;
};

// Parse the dataset textarea: accept a JSON array of {question,answer}, or
// JSONL (one object per line). Returns undefined when blank (backend default).
function parseDataset(raw: string): unknown[] | undefined {
  const text = raw.trim();
  if (!text) return undefined;
  try {
    const asArray = JSON.parse(text);
    if (Array.isArray(asArray)) return asArray;
  } catch {
    // fall through to JSONL parsing
  }
  const rows = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
  return rows;
}

export default function DeployEnvPage() {
  const account = useCurrentAccount();
  const client = useSuiClient();
  const { open } = useWalletModal();
  const { mutateAsync: signExec } = useSignAndExecuteTransaction();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [dataset, setDataset] = useState("");

  const [deployState, setDeployState] = useState<
    "idle" | "preparing" | "signing" | "done" | "error"
  >("idle");
  const [deployErr, setDeployErr] = useState("");
  const [deploy, setDeploy] = useState<DeployResult | null>(null);
  const [envId, setEnvId] = useState<string | null>(null);
  const [deployDigest, setDeployDigest] = useState<string | null>(null);

  const [verifyState, setVerifyState] = useState<
    "idle" | "running" | "signing" | "done" | "error"
  >("idle");
  const [verifyErr, setVerifyErr] = useState("");
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [attestationId, setAttestationId] = useState<string | null>(null);
  const [verifyDigest, setVerifyDigest] = useState<string | null>(null);
  const [runningModel, setRunningModel] = useState<string>("");

  const canDeploy = name.trim().length > 1;
  const deployBusy = deployState === "preparing" || deployState === "signing";
  const verifyBusy = verifyState === "running" || verifyState === "signing";

  async function handleDeploy() {
    if (!account) {
      open();
      return;
    }
    if (!canDeploy) return;
    setDeployErr("");
    setDeploy(null);
    try {
      let parsed: unknown[] | undefined;
      try {
        parsed = parseDataset(dataset);
      } catch {
        throw new Error(
          "Dataset must be a JSON array of {question, answer} objects, or JSONL (one per line).",
        );
      }

      setDeployState("preparing");
      const res = await fetch("/api/deploy-env", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          ...(parsed ? { dataset: parsed } : {}),
        }),
      });
      const text = await res.text();
      if (!res.ok || !text) {
        throw new Error(
          `verifier service unreachable — start it on :8077 (${res.status})`,
        );
      }
      const data: DeployResult = JSON.parse(text);

      setDeployState("signing");
      const tx = new Transaction();
      // create_world_entry(name, description, tags, artifact_uri, ctx)
      tx.moveCall({
        target: `${PKG}::environment::create_world_entry`,
        arguments: [
          tx.pure.string(name.trim()),
          tx.pure.string(description.trim()),
          tx.pure.vector("string", []),
          tx.pure.string(data.artifact_uri),
        ],
      });
      const signed = await signExec({ transaction: tx });
      await client.waitForTransaction({ digest: signed.digest });
      const block = await client.getTransactionBlock({
        digest: signed.digest,
        options: { showObjectChanges: true },
      });
      const created = block.objectChanges?.find(
        (c) =>
          c.type === "created" &&
          String(c.objectType ?? "").endsWith("::environment::Environment"),
      );
      if (!created || created.type !== "created") {
        throw new Error(
          "Transaction landed but no ::environment::Environment object was created.",
        );
      }

      setEnvId(created.objectId);
      setDeployDigest(signed.digest);
      setDeploy(data);
      setDeployState("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setDeployErr(
        /gas|balance|insufficient/i.test(msg)
          ? "No gas — fund this address from the testnet faucet."
          : msg,
      );
      setDeployState("error");
    }
  }

  async function handleVerify() {
    if (!envId) return;
    if (!account) {
      open();
      return;
    }
    setVerifyErr("");
    setVerify(null);
    try {
      setRunningModel("a sample OSS LLM");
      setVerifyState("running");
      const res = await fetch("/api/verify-env", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ env_id: envId }),
      });
      const text = await res.text();
      if (!res.ok || !text) {
        throw new Error(
          `verifier service unreachable — start it on :8077 (${res.status})`,
        );
      }
      const data: VerifyResult = JSON.parse(text);
      setRunningModel(data.model);

      setVerifyState("signing");
      const tx = new Transaction();
      tx.moveCall({
        target: `${PKG}::env_verifier::verify_epoch_entry`,
        arguments: [
          tx.pure.id(envId),
          tx.pure.vector(
            "u8",
            Array.from(fromHex(data.attester_pk.replace(/^0x/, ""))),
          ),
          tx.pure.u8(data.intent),
          tx.pure.u64(data.timestamp_ms),
          tx.pure.string(data.model),
          tx.pure.u64(data.n_samples),
          tx.pure.u64(data.mean_reward_bps),
          tx.pure.u64(data.pass_bps),
          tx.pure.vector(
            "u8",
            Array.from(fromHex(data.dataset_hash.replace(/^0x/, ""))),
          ),
          tx.pure.vector(
            "u8",
            Array.from(fromHex(data.signature.replace(/^0x/, ""))),
          ),
        ],
      });
      const signed = await signExec({ transaction: tx });
      await client.waitForTransaction({ digest: signed.digest });
      const block = await client.getTransactionBlock({
        digest: signed.digest,
        options: { showObjectChanges: true },
      });
      const created = block.objectChanges?.find(
        (c) =>
          c.type === "created" &&
          String(c.objectType ?? "").endsWith(
            "::env_verifier::EpochAttestation",
          ),
      );

      setAttestationId(
        created && created.type === "created" ? created.objectId : null,
      );
      setVerifyDigest(signed.digest);
      setVerify(data);
      setVerifyState("done");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVerifyErr(
        /gas|balance|insufficient/i.test(msg)
          ? "No gas — fund this address from the testnet faucet."
          : msg,
      );
      setVerifyState("error");
    }
  }

  return (
    <AppShell>
      <main className="mx-auto w-full max-w-4xl flex-1 px-5 py-8 sm:px-8">
        <Link
          href="/"
          className="font-mono text-xs text-ink/50 underline-offset-4 hover:underline"
        >
          ← dashboard
        </Link>

        <header className="mt-5 border-b border-ink/15 pb-6">
          <h1 className="text-3xl font-medium tracking-tight">
            Deploy &amp; verify an RL environment
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-ink/60">
            Register a reinforcement-learning environment on Sui, then prove it
            is real and trainable: one epoch runs on a sample OSS LLM inside a
            TEE enclave (Nautilus), and the enclave signature is verified
            on-chain.
          </p>
        </header>

        {!account && (
          <div className="mt-6 flex items-center justify-between gap-4 border border-accent/30 bg-accent/[0.06] px-4 py-3 text-sm">
            <span className="text-ink/70">
              Connect your Sui wallet to deploy an environment.
            </span>
            <button
              onClick={open}
              className="shrink-0 bg-ink px-3 py-1.5 text-xs font-medium text-background transition-colors hover:bg-black"
            >
              Connect Wallet
            </button>
          </div>
        )}

        {/* STEP 1 — DEPLOY */}
        <Step n={1} title="Deploy the environment" active>
          <div className="flex flex-col gap-5">
            <div>
              <label className={labelCls}>Environment name</label>
              <input
                className={fieldCls}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Sort-List Bench"
                disabled={deployState === "done"}
              />
            </div>
            <div>
              <label className={labelCls}>Description</label>
              <textarea
                className={`${fieldCls} h-20 resize-none`}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does the agent learn in this environment?"
                disabled={deployState === "done"}
              />
            </div>
            <div>
              <label className={labelCls}>Dataset (optional)</label>
              <textarea
                className={`${fieldCls} h-44 resize-y font-mono text-[12px] leading-5`}
                value={dataset}
                onChange={(e) => setDataset(e.target.value)}
                placeholder={DATASET_PLACEHOLDER}
                disabled={deployState === "done"}
              />
              <p className="mt-1 text-[11px] text-ink/40">
                JSONL or a JSON array of {"{question, answer}"}. Leave blank to
                use the default sort-list task set.
              </p>
            </div>

            {deployState !== "done" && (
              <div>
                <button
                  onClick={handleDeploy}
                  disabled={deployBusy || (!!account && !canDeploy)}
                  className="rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {deployState === "preparing"
                    ? "Building dataset…"
                    : deployState === "signing"
                      ? "Registering on Sui…"
                      : account
                        ? "Deploy environment"
                        : "Connect to deploy"}
                </button>
              </div>
            )}

            {deployState === "error" && (
              <p className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-600">
                {deployErr}
              </p>
            )}

            {deployState === "done" && deploy && envId && (
              <div className="space-y-3">
                <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/[0.1] px-3 py-1 font-mono text-sm text-accent">
                  ✓ Environment registered
                </div>
                <div className="grid gap-px overflow-hidden rounded-lg border border-ink/15 bg-ink/10 sm:grid-cols-2">
                  <Row k="Tasks in dataset" v={String(deploy.n_tasks)} />
                  <Row
                    k="Environment"
                    v={envId}
                    mono
                    link={scanObject(envId)}
                  />
                  <Row k="Dataset hash" v={deploy.dataset_hash} mono />
                  {deployDigest && (
                    <Row
                      k="Deploy tx"
                      v={deployDigest}
                      mono
                      link={scanTx(deployDigest)}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        </Step>

        {/* STEP 2 — VERIFY */}
        <Step n={2} title="Verify via epoch + Nautilus" active={!!envId}>
          {!envId ? (
            <p className="text-sm text-ink/45">
              Deploy an environment first to unlock TEE-attested verification.
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="max-w-2xl text-sm text-ink/60">
                Runs one epoch on a sample OSS LLM, attested by a TEE enclave
                (Nautilus); the enclave signature is verified on-chain via{" "}
                <span className="font-mono text-[12px]">verify_epoch_entry</span>
                .
              </p>

              {verifyState !== "done" && (
                <div>
                  <button
                    onClick={handleVerify}
                    disabled={verifyBusy}
                    className="rounded-full border border-ink bg-ink px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-transparent hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {verifyState === "running"
                      ? `Running epoch on ${runningModel}…`
                      : verifyState === "signing"
                        ? "Recording attestation…"
                        : "Run verification epoch (Nautilus)"}
                  </button>
                  {verifyState === "running" && (
                    <p className="mt-2 text-[11px] text-ink/40">
                      Real model epoch — this can take ~40s.
                    </p>
                  )}
                </div>
              )}

              {verifyState === "error" && (
                <p className="rounded-md border border-rose-500/30 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-600">
                  {verifyErr}
                </p>
              )}

              {verifyState === "done" && verify && (
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/[0.1] px-3 py-1 font-mono text-sm text-accent">
                    ✓ Nautilus-verified
                  </div>
                  <div className="grid gap-px overflow-hidden rounded-lg border border-ink/15 bg-ink/10 sm:grid-cols-2">
                    <Row k="Mean reward" v={pct(verify.mean_reward_bps)} />
                    <Row k="Pass rate" v={pct(verify.pass_bps)} />
                    <Row k="Samples" v={String(verify.n_samples)} />
                    <Row k="Sample model" v={verify.model} />
                    <Row
                      k="Attester pubkey"
                      v={truncate(verify.attester_pk)}
                      mono
                    />
                    <Row k="Dataset hash" v={verify.dataset_hash} mono />
                    {attestationId && (
                      <Row
                        k="EpochAttestation"
                        v={attestationId}
                        mono
                        link={scanObject(attestationId)}
                      />
                    )}
                    {verifyDigest && (
                      <Row
                        k="Verify tx"
                        v={verifyDigest}
                        mono
                        link={scanTx(verifyDigest)}
                      />
                    )}
                  </div>
                  <p className="text-[11px] leading-5 text-ink/40">
                    Epoch run on a sample OSS LLM, attested by a TEE enclave
                    (Nautilus); the enclave signature is verified on-chain.
                  </p>
                </div>
              )}
            </div>
          )}
        </Step>
      </main>

      <footer className="border-t border-ink/15 px-5 py-6 sm:px-8">
        <div className="mx-auto flex max-w-4xl items-center justify-between font-mono text-xs text-ink/40">
          <Link href="/" className="hover:text-ink">
            ← back
          </Link>
          <span>sui {NET}</span>
        </div>
      </footer>
    </AppShell>
  );
}

function pct(bps: number): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

function truncate(s: string): string {
  return s.length > 20 ? `${s.slice(0, 12)}…${s.slice(-6)}` : s;
}

function Step({
  n,
  title,
  active,
  children,
}: {
  n: number;
  title: string;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={`mt-8 ${active ? "" : "opacity-60"}`}>
      <div className="mb-4 flex items-center gap-3">
        <span
          className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium ${
            active
              ? "border-accent bg-accent/[0.1] text-accent"
              : "border-ink/30 text-ink/40"
          }`}
        >
          {n}
        </span>
        <h2 className="text-lg font-medium tracking-tight">{title}</h2>
      </div>
      <div className="border-l border-ink/10 pl-5 sm:pl-7">{children}</div>
    </section>
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
  const display = mono && text.length > 22 ? `${text.slice(0, 22)}…` : text;
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
        <span
          className={
            mono ? "font-mono text-xs text-ink/80" : "text-sm text-ink/80"
          }
        >
          {display}
        </span>
      )}
    </div>
  );
}
