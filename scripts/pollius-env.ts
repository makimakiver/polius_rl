#!/usr/bin/env -S npx tsx
/**
 * pollius-env — deploy an RL environment on-chain.
 *
 *   npx tsx scripts/pollius-env.ts deploy <dir> [--epoch] [--epochs N]
 *
 * Steps:
 *   1. VERIFY  — validate the bundle (dataset shape + optional epoch run on the
 *                sample OSS LLM via the verifier service).
 *   2. WALRUS  — upload dataset.json (+ reward.py) + a manifest to Walrus testnet,
 *                getting decentralized blob ids.
 *   3. ON-CHAIN — register the Environment via `environment::create_world_entry`
 *                with artifact_uri = walrus://<manifest blob>, using the local Sui
 *                CLI keystore (no key handling here).
 *
 * Bundle layout (<dir>/):
 *   manifest.json   { "name": string, "description": string, "tags"?: string[] }
 *   dataset.json    [ { "question": string, "answer": string }, ... ]
 *   reward.py       (optional) the grader code
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

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
  const canon = JSON.stringify(dataset).replace(/\s+/g, "");
  // match python json.dumps(sort_keys=True, separators=(",",":")) for [{question,answer}]
  const sorted = (dataset as Record<string, unknown>[]).map((r) =>
    Object.fromEntries(Object.entries(r).sort(([a], [b]) => a.localeCompare(b))),
  );
  const py = JSON.stringify(sorted);
  void canon;
  return "0x" + createHash("sha256").update(py).digest("hex");
}

async function walrusPut(bytes: Buffer | string, epochs = 5): Promise<string> {
  const body = typeof bytes === "string" ? bytes : new Uint8Array(bytes);
  const r = await fetch(`${PUBLISHER}/v1/blobs?epochs=${epochs}`, {
    method: "PUT",
    body,
  });
  if (!r.ok) die(`Walrus upload failed (${r.status})`);
  const d = (await r.json()) as any;
  const id = d.newlyCreated?.blobObject?.blobId ?? d.alreadyCertified?.blobId;
  if (!id) die(`Walrus response had no blobId: ${JSON.stringify(d).slice(0, 200)}`);
  return id as string;
}

async function verify(dataset: unknown[], name: string): Promise<{ dataset_hash: string }> {
  try {
    const r = await fetch(`${VERIFIER}/deploy-env`, {
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

async function deploy(dir: string, runEpoch: boolean) {
  if (!PKG) die("NEXT_PUBLIC_PKG_ID not set (in env or .env.local)");
  const manifestPath = join(dir, "manifest.json");
  const datasetPath = join(dir, "dataset.json");
  if (!existsSync(manifestPath)) die(`missing ${manifestPath}`);
  if (!existsSync(datasetPath)) die(`missing ${datasetPath}`);

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8"));
  if (!Array.isArray(dataset) || !dataset.every((r) => r.question && r.answer))
    die("dataset.json must be an array of { question, answer }");
  const name: string = manifest.name ?? "untitled-env";
  const description: string = manifest.description ?? "";
  const tags: string[] = manifest.tags ?? [];
  const codePath = join(dir, "reward.py");
  const hasCode = existsSync(codePath);

  console.log(`\n▸ Deploying environment "${name}" (${dataset.length} tasks) on ${NET}\n`);

  // 1. verify
  console.log("1/3 verify");
  const { dataset_hash } = await verify(dataset, name);
  if (runEpoch) {
    console.log("  running an epoch on the sample OSS LLM (this can take ~40s)…");
    try {
      const r = await fetch(`${VERIFIER}/verify-env`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ env_id: "0x0", dataset, grader: manifest.grader, system: manifest.system }),
      });
      const d = (await r.json()) as any;
      console.log(`  epoch: ${d.model} · reward ${d.mean_reward_bps / 100}% · pass ${d.pass_bps / 100}% · attested_by ${d.attested_by}`);
    } catch {
      console.log("  (epoch skipped — verifier offline)");
    }
  }

  // 2. walrus
  console.log("2/3 walrus upload");
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

  // 3. on-chain
  console.log("3/3 register on-chain (create_world_entry)");
  const out = execFileSync(
    "sui",
    [
      "client", "call",
      "--package", PKG,
      "--module", "environment",
      "--function", "create_world_entry",
      "--args", name, description, JSON.stringify(tags), artifactUri,
      "--json",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const res = JSON.parse(out);
  const envObj = (res.objectChanges ?? []).find(
    (c: any) => c.type === "created" && String(c.objectType).endsWith("::environment::Environment"),
  );
  const envId = envObj?.objectId;

  console.log(`\n✓ Environment deployed on ${NET}`);
  console.log(`  env object : ${envId}`);
  console.log(`  artifact   : ${artifactUri}`);
  console.log(`  dataset    : https://walruscan.com/testnet/blob/${datasetBlob}`);
  if (codeBlob) console.log(`  reward.py  : https://walruscan.com/testnet/blob/${codeBlob}`);
  console.log(`  suiscan    : https://suiscan.xyz/${NET}/object/${envId}`);
  console.log(`\nIt will appear on the marketplace under On-chain environments.`);
}

const [cmd, dir, ...flags] = process.argv.slice(2);
if (cmd !== "deploy" || !dir) {
  console.log("usage: npx tsx scripts/pollius-env.ts deploy <dir> [--epoch]");
  process.exit(cmd ? 1 : 0);
}
deploy(dir, flags.includes("--epoch")).catch((e) => die(String(e?.message ?? e)));
