#!/usr/bin/env node
/**
 * pollius-env — deploy an RL environment on-chain (Pollius / Sui).
 *
 *   pollius-env deploy <dir> [--epoch]
 *
 * Pipeline:
 *   1. VERIFY   — validate the bundle (dataset shape) + register it with the
 *                 verifier service, which returns the canonical dataset hash.
 *   2. WALRUS   — upload dataset.json (+ reward.py) + a manifest blob to Walrus,
 *                 getting decentralized blob ids; artifact_uri = walrus://<manifest>.
 *   3. ON-CHAIN — register the Environment via `environment::create_world_entry`
 *                 using the local Sui CLI keystore (no key handling here).
 *   4. ATTEST   — (with --epoch) run ONE epoch on the sample OSS LLM, scored by
 *                 the env's grader, attested by a TEE (Nautilus/Nitro), then
 *                 submit `env_verifier::verify_epoch_entry` to mint an on-chain
 *                 EpochAttestation bound to the real env id.
 *
 * Bundle layout (<dir>/):
 *   manifest.json   { "name": string, "description"?: string, "tags"?: string[],
 *                     "system"?: string, "grader"?: string }
 *   dataset.json    [ { "question": string, "answer": string }, ... ]
 *   reward.py       (optional) the grader code, uploaded for transparency
 *
 * Config (env or .env.local in cwd):
 *   NEXT_PUBLIC_PKG_ID        (required) the deployed pols_core package id
 *   NEXT_PUBLIC_SUI_NETWORK   testnet (default) | mainnet | devnet | localnet
 *   PY_VERIFIER_URL           verifier service base url (default http://localhost:8077)
 *   WALRUS_PUBLISHER          Walrus publisher base url (default testnet publisher)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fetchFn: typeof fetch = (globalThis as { fetch: typeof fetch }).fetch;

const PUBLISHER = process.env.WALRUS_PUBLISHER ?? "https://publisher.walrus-testnet.walrus.space";
const VERIFIER = process.env.PY_VERIFIER_URL ?? "http://localhost:8077";

function envFromDotenv(key: string): string | undefined {
  try {
    const txt = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    const m = txt.match(new RegExp(`^${key}=(.*)$`, "m"));
    return m?.[1]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

const PKG = process.env.NEXT_PUBLIC_PKG_ID ?? envFromDotenv("NEXT_PUBLIC_PKG_ID");
const NET = process.env.NEXT_PUBLIC_SUI_NETWORK ?? envFromDotenv("NEXT_PUBLIC_SUI_NETWORK") ?? "testnet";

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

/** Canonical dataset hash — must match verifier/epoch.py dataset_hash(). */
function datasetHash(dataset: unknown): string {
  const sorted = (dataset as Record<string, unknown>[]).map((r) =>
    Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))),
  );
  // match python json.dumps(sort_keys=True, separators=(",",":"))
  const py = JSON.stringify(sorted);
  return "0x" + createHash("sha256").update(py).digest("hex");
}

async function walrusPut(bytes: Buffer | string, epochs = 5): Promise<string> {
  const body = typeof bytes === "string" ? bytes : new Uint8Array(bytes);
  const r = await fetchFn(`${PUBLISHER}/v1/blobs?epochs=${epochs}`, { method: "PUT", body });
  if (!r.ok) die(`Walrus upload failed (${r.status})`);
  const d = (await r.json()) as Record<string, any>;
  const id = d.newlyCreated?.blobObject?.blobId ?? d.alreadyCertified?.blobId;
  if (!id) die(`Walrus response had no blobId: ${JSON.stringify(d).slice(0, 200)}`);
  return id as string;
}

async function registerWithVerifier(dataset: unknown[], name: string): Promise<{ dataset_hash: string }> {
  try {
    const r = await fetchFn(`${VERIFIER}/deploy-env`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, dataset }),
    });
    if (r.ok) {
      const d = (await r.json()) as any;
      console.log(`  verifier: ${d.n_tasks} tasks · dataset_hash ${d.dataset_hash.slice(0, 18)}…`);
      return { dataset_hash: d.dataset_hash };
    }
  } catch {
    /* verifier down — fall back to local hash */
  }
  console.log("  verifier offline — hashing locally");
  return { dataset_hash: datasetHash(dataset) };
}

type EpochAttestation = {
  model: string;
  n_samples: number;
  mean_reward_bps: number;
  pass_bps: number;
  dataset_hash: string;
  attester_pk: string;
  signature: string;
  intent: number;
  timestamp_ms: number;
  attested_by: string;
};

/** Run one attested epoch against the REAL env id (so the signature binds to it). */
async function runEpoch(
  envId: string,
  dataset: unknown[],
  grader: string | undefined,
  system: string | undefined,
): Promise<EpochAttestation | null> {
  try {
    const r = await fetchFn(`${VERIFIER}/verify-env`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ env_id: envId, dataset, grader, system }),
    });
    if (!r.ok) {
      console.log(`  (epoch skipped — verifier ${r.status})`);
      return null;
    }
    const d = (await r.json()) as EpochAttestation;
    console.log(
      `  epoch: ${d.model} · reward ${d.mean_reward_bps / 100}% · pass ${d.pass_bps / 100}% · attested_by ${d.attested_by}`,
    );
    return d;
  } catch {
    console.log("  (epoch skipped — verifier offline)");
    return null;
  }
}

/** Mint the on-chain EpochAttestation via env_verifier::verify_epoch_entry. */
function submitAttestation(envId: string, a: EpochAttestation): string | undefined {
  const out = sui([
    "client", "call",
    "--package", PKG as string,
    "--module", "env_verifier",
    "--function", "verify_epoch_entry",
    "--args",
    envId,
    a.attester_pk,
    String(a.intent),
    String(a.timestamp_ms),
    a.model,
    String(a.n_samples),
    String(a.mean_reward_bps),
    String(a.pass_bps),
    a.dataset_hash,
    a.signature,
    "--json",
  ]);
  const res = JSON.parse(out);
  const att = (res.objectChanges ?? []).find(
    (c: any) => c.type === "created" && String(c.objectType).endsWith("::env_verifier::EpochAttestation"),
  );
  return att?.objectId;
}

function sui(args: string[]): string {
  return execFileSync("sui", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
}

async function deploy(dir: string, withEpoch: boolean, nameOverride?: string) {
  if (!PKG) die("NEXT_PUBLIC_PKG_ID not set (in env or .env.local)");
  const manifestPath = join(dir, "manifest.json");
  const datasetPath = join(dir, "dataset.json");
  if (!existsSync(manifestPath)) die(`missing ${manifestPath}`);
  if (!existsSync(datasetPath)) die(`missing ${datasetPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  if (!Array.isArray(dataset) || !dataset.every((r) => r.question && r.answer))
    die("dataset.json must be an array of { question, answer }");
  const name: string = nameOverride ?? manifest.name ?? "untitled-env";
  const description: string = manifest.description ?? "";
  const tags: string[] = manifest.tags ?? [];
  const codePath = join(dir, "reward.py");
  const hasCode = existsSync(codePath);
  const steps = withEpoch ? 4 : 3;

  console.log(`\n▸ Deploying environment "${name}" (${dataset.length} tasks) on ${NET}\n`);

  // 1. verify
  console.log(`1/${steps} verify`);
  const { dataset_hash } = await registerWithVerifier(dataset, name);

  // 2. walrus
  console.log(`2/${steps} walrus upload`);
  const datasetBlob = await walrusPut(Buffer.from(JSON.stringify(dataset)));
  console.log(`  dataset → ${datasetBlob}`);
  let codeBlob = "";
  if (hasCode) {
    codeBlob = await walrusPut(readFileSync(codePath));
    console.log(`  reward.py → ${codeBlob}`);
  }
  const manifestBlob = await walrusPut(
    Buffer.from(JSON.stringify({ name, description, tags, dataset_hash, datasetBlob, codeBlob })),
  );
  const artifactUri = `walrus://${manifestBlob}`;
  console.log(`  manifest → ${manifestBlob}`);

  // 3. on-chain register
  console.log(`3/${steps} register on-chain (create_world_entry)`);
  const res = JSON.parse(
    sui([
      "client", "call",
      "--package", PKG,
      "--module", "environment",
      "--function", "create_world_entry",
      "--args", name, description, JSON.stringify(tags), artifactUri,
      "--json",
    ]),
  );
  const envObj = (res.objectChanges ?? []).find(
    (c: any) => c.type === "created" && String(c.objectType).endsWith("::environment::Environment"),
  );
  const envId: string | undefined = envObj?.objectId;

  // 4. attest (epoch on the real env id → on-chain EpochAttestation)
  let attId: string | undefined;
  if (withEpoch && envId) {
    console.log(`4/${steps} attest epoch (Nautilus) → verify_epoch_entry`);
    console.log("  running an epoch on the sample OSS LLM (this can take ~40s)…");
    const att = await runEpoch(envId, dataset, manifest.grader, manifest.system);
    if (att) {
      try {
        attId = submitAttestation(envId, att);
        console.log(`  attestation minted: ${attId}`);
      } catch (e: any) {
        console.log(`  (on-chain attestation skipped — ${String(e?.message ?? e).slice(0, 120)})`);
      }
    }
  }

  console.log(`\n✓ Environment deployed on ${NET}`);
  console.log(`  env object  : ${envId}`);
  console.log(`  artifact    : ${artifactUri}`);
  console.log(`  dataset     : https://walruscan.com/testnet/blob/${datasetBlob}`);
  if (codeBlob) console.log(`  reward.py   : https://walruscan.com/testnet/blob/${codeBlob}`);
  console.log(`  suiscan     : https://suiscan.xyz/${NET}/object/${envId}`);
  if (attId) console.log(`  attestation : https://suiscan.xyz/${NET}/object/${attId}`);
  console.log(`\nIt will appear on the marketplace under On-chain environments.`);
}

/** Parse deploy flags. Supports `--epoch`, `--name <value>` and `--name=<value>`. */
export function parseDeployArgs(flags: string[]): { withEpoch: boolean; name?: string } {
  let withEpoch = false;
  let name: string | undefined;
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === "--epoch") withEpoch = true;
    else if (f === "--name") {
      name = flags[++i];
      if (name === undefined || name.startsWith("--")) die("--name requires a value");
    } else if (f.startsWith("--name=")) {
      name = f.slice("--name=".length);
      if (!name) die("--name requires a value");
    }
  }
  return { withEpoch, name };
}

function main() {
  const [cmd, dir, ...flags] = process.argv.slice(2);
  if (cmd !== "deploy" || !dir) {
    console.log('usage: pollius-env deploy <dir> [--epoch] [--name "<env name>"]');
    process.exit(cmd ? 1 : 0);
  }
  const { withEpoch, name } = parseDeployArgs(flags);
  deploy(dir, withEpoch, name).catch((e) => die(String(e?.message ?? e)));
}

// Run only when invoked as the CLI. Resolve symlinks so this also fires through
// bin shims (npx, global install, node_modules/.bin); importing for tests won't match.
function isCliEntry(): boolean {
  try {
    return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (isCliEntry()) main();
