/**
 * Lean inference-market data + logic (pure, no React).
 *
 * The lean-prover listing is REAL: produced by `market_bridge.py` in the Python
 * repo, which runs the actual SGS pipeline — loads the local Qwen, proves the
 * curated theorems with the Lean verifier (sample input/output + verified), and
 * has the conjecturer (SPG) generate synthetic problems admitted through Lean.
 * Its data is imported from `market.generated.json`. The other listings are
 * illustrative mocks that show the simulated FAIL→PASS self-improvement arc.
 *
 * Two sample shapes are supported:
 *   - real  : { input, output, verified }            (one real version, from the bridge)
 *   - seeded: { input, goodOutput, badOutput, minVersion }  (simulated multi-version)
 */

import generatedJson from "./market.generated.json";

export interface ModelVersion {
  v: number;
  passRateBps: number; // verifier-measured, 0..10000
  walrusBlobId: string;
}

/**
 * Each model is graded by EITHER an on-chain or an off-chain verifier — a property
 * of its environment, not a split within one inference:
 *   - off-chain: Lean theorem proving (the lake compiler; no on-chain activity)
 *   - on-chain : DeFi trading (realized PnL after gas/slippage, settled on Sui)
 */
export interface Verifier {
  kind: "onchain" | "offchain" | "judge0";
  name: string;
  detail: string;
}

export interface Sample {
  input: string;
  // real (bridge-generated):
  output?: string;
  verified?: boolean;
  // seeded (simulated FAIL→PASS):
  goodOutput?: string;
  badOutput?: string;
  minVersion?: number;
}

export interface Listing {
  id: string;
  modelName: string;
  task: string;
  environmentId: string; // the on-chain RL environment this model was trained on
  verifier: Verifier; // on-chain (PnL) or off-chain (Lean) — how this model is graded
  priceSui: number;
  priceMist: number;
  currentVersion: number;
  versions: ModelVersion[];
  samples: Sample[];
  spgProblems?: string[]; // SPG-generated training problems (Lean-admitted)
  totalCalls: number;
  deployedAt: string;
  real?: boolean; // true → produced by market_bridge.py (real model + Lean)
}

export interface RunResult {
  verified: boolean;
  output: string;
  version: number;
  passRateBps: number;
  attestationBlobId: string;
  txDigest?: string;
  // judge0-verified runs (executed in a sandbox via MPP, attested on Sui):
  status?: string;
  judge0Token?: string;
  usdcPayDigest?: string;
  verifiedReceiptId?: string;
}

const generated: Listing[] = (
  generatedJson as { listings: Omit<Listing, "verifier" | "real">[] }
).listings.map((l) => ({
  ...l,
  real: true,
  verifier: {
    kind: "offchain",
    name: "Lean 4 (lake)",
    detail: "proof compiles in the Lean checker — no on-chain activity",
  },
}));

/**
 * Illustrative listing: a DeFi trading model whose verifier IS on-chain — its
 * outputs are graded by realized PnL settled on Sui (the future on-chain case).
 */
const seeded: Listing[] = [
  {
    id: "trade-strat",
    modelName: "qwen-0.5b-trader",
    task: "DeFi trading strategy",
    environmentId: "trading-bandit",
    verifier: {
      kind: "onchain",
      name: "On-chain PnL",
      detail: "realized PnL after gas + slippage, settled on Sui",
    },
    priceSui: 0.2,
    priceMist: 200_000_000,
    currentVersion: 2,
    versions: [
      { v: 0, passRateBps: 3000, walrusBlobId: "nUEB_trade_v0" },
      { v: 1, passRateBps: 4500, walrusBlobId: "nUEB_trade_v1" },
      { v: 2, passRateBps: 5800, walrusBlobId: "nUEB_trade_v2" },
      { v: 3, passRateBps: 7000, walrusBlobId: "nUEB_trade_v3" },
    ],
    totalCalls: 410,
    deployedAt: "2026-06-16",
    samples: [
      {
        input:
          "SUI/USDC pool is 2% above the oracle mid with thin asks. Suggest a swap to capture the gap.",
        goodOutput:
          "Sell 1,200 SUI into the asks up to the oracle mid; expected +0.8% net of gas/slippage. Verified by realized PnL on settlement.",
        badOutput: "Buy more SUI — price is going up.",
        minVersion: 2,
      },
    ],
  },
  {
    id: "sort-list",
    modelName: "qwen-0.5b-sorter",
    task: "Sort integers (negatives + duplicates)",
    environmentId: "sort-list",
    verifier: {
      kind: "judge0",
      name: "Judge0",
      detail:
        "code executed in a sandbox via MPP (0.02 USDC), verdict attested on Sui",
    },
    priceSui: 0.1,
    priceMist: 100_000_000,
    currentVersion: 0,
    versions: [
      { v: 0, passRateBps: 2000, walrusBlobId: "nUEB_sort_v0" },
      { v: 1, passRateBps: 3500, walrusBlobId: "nUEB_sort_v1" },
      { v: 2, passRateBps: 8000, walrusBlobId: "nUEB_sort_v2" },
      { v: 3, passRateBps: 10000, walrusBlobId: "nUEB_sort_v3" },
    ],
    totalCalls: 0,
    deployedAt: "2026-06-20",
    samples: [
      {
        input: "5 -3 5 0 -3 9",
        goodOutput: "-3 -3 0 5 5 9",
        badOutput: "5 -3 5 0 -3 9",
        minVersion: 2,
      },
    ],
  },
];

/** All deployed inference models (real first). */
export const LISTINGS: Listing[] = [...generated, ...seeded];

export const MIST_PER_SUI = 1_000_000_000;

export function getListing(id: string): Listing | undefined {
  return LISTINGS.find((l) => l.id === id);
}

export function maxVersion(l: Listing): number {
  return l.versions.length - 1;
}

export function versionAt(l: Listing, version: number): ModelVersion {
  return l.versions[Math.max(0, Math.min(maxVersion(l), version))];
}

export function passCurve(l: Listing, version: number): number[] {
  return l.versions.slice(0, version + 1).map((m) => m.passRateBps / 10000);
}

/** True iff the model at `version` produces a verifier-accepted output for `s`. */
export function proves(version: number, s: Sample): boolean {
  if (s.minVersion === undefined) return !!s.verified; // real sample: fixed verdict
  return version >= s.minVersion;
}

/** Deterministic stand-in for the /prove call (real samples return their actual output). */
export function runSample(
  l: Listing,
  s: Sample,
  version: number,
  txDigest?: string,
): RunResult {
  const m = versionAt(l, version);
  const verified = proves(version, s);
  const output =
    s.output !== undefined ? s.output : verified ? s.goodOutput ?? "" : s.badOutput ?? "";
  return {
    verified,
    output,
    version,
    passRateBps: m.passRateBps,
    attestationBlobId: `att_${l.id}_v${version}_${m.walrusBlobId.slice(-6)}`,
    txDigest,
  };
}

export function passPct(bps: number): string {
  return `${(bps / 100).toFixed(0)}%`;
}
