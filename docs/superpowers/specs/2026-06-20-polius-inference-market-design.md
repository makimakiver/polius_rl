# Polius — Verifiable Inference Market on Sui — Design

**Date:** 2026-06-20
**Status:** Brainstorming → ready for implementation plan
**Repos:** `pollius_rl` (Next.js 16 + Move + Sui glue) ↔ `pollius_demo_llm_post_training` (Python: RL + inference)
**Goal:** The most polished version of Polius — an inference market positioned like **Suilend** in the Sui
ecosystem (dense, professional, data-rich, wallet-first) — where off-chain LLM inference is **verified**
through **Judge0 (accessed via the MPP gateway, paid in USDC on Sui)** and the verdict is recorded on-chain.

---

## 0. One-line thesis

**An environment is a tradeable on-chain asset = a problem distribution `D` + the verifier `v` that grades it.**
You sell **LLM inference** on top of it pay-per-call, and you don't sell a string — you sell a
**verifiably-correct result**: the model's answer is executed in **Judge0** and the verdict (plus the
re-runnable Judge0 token) is attested on-chain. Quality is the Judge0 pass-rate, so "this model is
self-improving" is *provable on screen*, not asserted — the same number the RL loop optimizes, buyers
re-check on every call.

This is the SGS recipe (`SGS_in_the_real_world.md`) made financial: the **verifier is the moat**, and the
environment's `fee_pool` is a claim on how useful a verifiable skill becomes.

---

## 1. The two load-bearing definitions

### 1.1 What an "environment" is

An environment is the shared Sui object `pols_core::environment::Environment` (`world.move:40`). It already
carries everything that defines the asset:

```move
public struct Environment has key {
    id, name, description, tags,
    artifact_uri,            // pointer to the task bank D / verifier spec (Walrus or git)
    version,
    fee_pool: Balance<SUI>,  // accrues 30% of every inference sold on top of it
    legit_until,
}
```

SGS → on-chain mapping:

| SGS piece | Lives in | Definition |
|---|---|---|
| **Target set `D`** | `artifact_uri` + `tags` | the curated task bank — for the demo, the `sort_list` problems (shuffled int lists → ascending) |
| **Verifier `v`** | convention bound to the env (surfaced as `verifier.kind`) | **Judge0** — deterministic code execution. *This is what makes `D` an asset.* |
| **Value accrual** | `fee_pool` | 30% of every verified inference, from any model trained on this env |

Defining an environment = registering an object that asserts *"here is distribution `D`, and here is the
exact verifier that grades solutions to it."* Created via `create_world_entry(name, description, tags,
artifact_uri)` (the existing `/deploy` page). **The verifier defines the asset as much as the problems do**:
a `sort_list`/Judge0 env and a `lean-prover`/Lean env are different assets even with overlapping prompts,
because `v` is what buyers trust.

### 1.2 What "selling LLM inference" is

Pay-per-call against a `ModelRegistry` (one served, self-improving model bound to one environment). Three
on-chain acts:

- **(a) Stock the shelf** — `publish_checkpoint(registry, cap, walrus_blob_id, pass_rate_bps, clock)`:
  appends a `ModelVersion` (LoRA adapter on Walrus + its Judge0-measured pass rate), advances
  `current_best`. A better checkpoint = a better SKU. This is where SGS improvement becomes product.
- **(b) Sell the call** — `buy_inference(registry, env, task_id, payment)` (`inference_market.move:125`):
  splits the fee **30% → `Environment.fee_pool`, 70% → `ModelRegistry.fee_pool`**, increments
  `total_calls`, emits `InferencePaid`, mints a **`Receipt`** to the buyer — the access token the off-chain
  server honors before generating.
- **(c) Prove the goods** (the new piece — see §4): the verifier service runs the model's output through
  Judge0 and records a **`VerifiedReceipt`** carrying the verdict + Judge0 token. The buyer receives a
  *verifiably-correct* result, not just a paid one.

**Pricing model:** per-call (one `buy_inference` = one served + verified inference). Credit/subscription is
an explicit non-goal for v1.

---

## 2. Goals / non-goals

**Goals**
- Real pay-per-inference on **Sui testnet** (SUI → fee pools, `Receipt` issued) — already shipped.
- **Verifiable** inference: the served answer is executed in **Judge0** and the verdict + re-runnable token
  are recorded on-chain in a `VerifiedReceipt`.
- Judge0 accessed through **MPP** (`mpp.t2000.ai`), paid **0.02 USDC on Sui** per run via x402 — so the
  *grading itself* settles on-chain.
- A **Suilend-grade UI**: a markets dashboard of environments + model listings (TVL = Σ fee pools, live
  pass-rate curves), a listing detail with buy→verify, and a **portfolio** of the user's
  `Receipt`/`VerifiedReceipt` positions.
- A scripted **demo flow** where the same task visibly goes **FAIL → PASS** as checkpoints improve, with the
  on-chain pass-rate climbing live and each PASS re-checkable via its Judge0 token.

**Non-goals (v1)**
- ❌ Credit token / subscriptions — pay directly in SUI per call (`lib/token.ts` stays a stretch).
- ❌ Real-time GPU RL as a hard requirement — the loop runs, but a seeded timeline of real checkpoints
  guarantees the curve moves on cadence.
- ❌ Full Nautilus/TEE in the core path — `pols_core::enclave` exists; the `VerifiedReceipt` is structured so
  the same verdict can later be produced by an enclave key instead of a bare verifier key (**upgrade path**,
  not v1 scope).
- ❌ Escrow/refunds, model routing, multi-model bidding — single `current_best` per registry.
- ❌ Free-form task input — curated `task_id`s only (de-risks the verifier + guarantees the FAIL→PASS arc).

---

## 3. The verifiable-inference loop (everything settles on Sui)

```
1. Buyer    → buy_inference(SUI)              → ModelRegistry.fee_pool (70%) + Environment.fee_pool (30%)
                                               → mints Receipt to buyer, emits InferencePaid
2. Verifier service sees the Receipt / InferencePaid:
     a. load current-best LoRA → generate a Python solution for task_id   (or deterministic stand-in, no GPU)
     b. POST mpp.t2000.ai/judge0/v1/submissions {source_code, language_id, stdin}
            → 402 → pay 0.02 USDC on Sui (x402, gasless via @t2000/sdk) → retry → execution result
     c. score vs hidden tests → pass_bps, output_hash, judge0_token
     d. secp256k1-sign  BCS(VerdictIntent{ registry, receipt_id, buyer, version, task_id,
                                           pass_bps, output_hash, judge0_token, ts })
     e. record_verified_inference(...)         → verifies sig vs registry.verifier_pk
                                               → mints VerifiedReceipt to buyer, emits InferenceVerified
3. RL loop  → publish_checkpoint(better LoRA)  → current_best advances, pass-rate chart climbs live
```

**Three on-chain payments / records per sale:** buyer's SUI (revenue), verifier's USDC to MPP (cost of
grading), the recorded verdict tx (the delivered product). **Honesty anchor:** the chart's `pass_rate` is the
*same* Judge0 number the RL loop optimizes and that buyers re-check on every call.

---

## 4. Move changes (`pols_core::inference_market`, fresh redeploy)

Mirrors existing conventions: `VERSION` gate, cap-gated mutation, events carry full snapshots, the
`register.move` secp256k1 verify pattern.

> **Deploy note:** adding fields to `ModelRegistry` changes its layout, so this is a **fresh publish** of
> `pols_core` (the package already redeploys per-iteration; new `NEXT_PUBLIC_PKG_ID` + registry/env ids), not
> an in-place upgrade.

```move
public struct ModelRegistry has key {
    id, environment, creator, current_best,
    versions: vector<ModelVersion>,
    fee_pool: Balance<SUI>,
    total_calls,
    // NEW:
    verifier_pk: vector<u8>,   // secp256k1 pubkey of the registry's verifier service
    verified_calls: u64,       // # of recorded verdicts
    last_pass_bps: u64,        // most recent verdict's pass rate (drives the live badge)
    verified_ts: Table<u64, bool>,  // replay guard on verdict ts (mirror register.move)
    version,
}

public struct VerifiedReceipt has key, store {
    id, registry, buyer, version,
    task_id: u64,
    pass_bps: u64,
    judge0_token: String,      // anyone can re-run this in Judge0 to audit
    output_hash: vector<u8>,
}

// signed off-chain by the verifier service; reconstructed + verified on-chain
public struct VerdictIntent has copy, drop {
    intent: u8,                // domain separator (e.g. 1)
    registry: ID, receipt_id: ID, buyer: address,
    version: u64, task_id: u64, pass_bps: u64,
    output_hash: vector<u8>, judge0_token: String, ts: u64,
}
```

**Entries / functions**
- `create_registry(environment, verifier_pk, ctx) -> PublisherCap` — extend the existing creator to take the
  verifier pubkey (+ `create_registry_entry`).
- `set_verifier(registry, cap, verifier_pk)` — cap-gated key rotation (and the upgrade seam to an enclave key).
- `record_verified_inference(registry, receipt_id, buyer, version, task_id, pass_bps, output_hash,
  judge0_token, ts, signature, ctx)` — reconstruct `BCS(VerdictIntent{..})`,
  `ecdsa_k1::secp256k1_verify(&signature, registry.verifier_pk, &bytes, 1)`, replay-guard on `ts`, set
  `last_pass_bps`, `verified_calls += 1`, mint `VerifiedReceipt` to `buyer`, emit `InferenceVerified`.
- Views: `verified_calls`, `last_pass_bps`, `verifier_pk`, `vreceipt_pass_bps`, `vreceipt_token`.

**Events (`events.move`)**
- `InferenceVerified { registry, buyer, version, task_id, pass_bps, judge0_token, output_hash }`.

**Tests (`inference_market_tests.move`)**
- valid verdict → mints `VerifiedReceipt`, bumps `verified_calls`/`last_pass_bps`, emits event;
- wrong signature aborts (`EInvalidSignature`);
- replayed `ts` aborts;
- `set_verifier` rotates the key (old sig now fails, new sig passes).

---

## 5. Off-chain verifier service (`pollius_rl/environments/`, Python FastAPI)

New files: `verifier_service.py` (FastAPI), `mpp_judge0.py` (x402 client), `verdict.py` (BCS + secp256k1
signing), plus a TS helper `scripts/mpp-record.ts` for the two Sui signers.

- `GET /model` → reads `ModelRegistry` over Sui RPC → `{version, pass_rate_bps, walrus_blob_id, verified_calls}`.
- `POST /verify {receipt_id, task_id}`:
  1. confirm payment on Sui (`getObject(receipt_id)` or scan `InferencePaid`);
  2. generate a Python solution for `task_id` (current-best LoRA from Walrus; deterministic stand-in if no GPU);
  3. `mpp_judge0.run(source_code, language_id=python, stdin)` — does the **402 → pay 0.02 USDC → retry** dance;
  4. score against the env's hidden tests → `pass_bps`, `output_hash = sha256(canonical_stdout)`, `judge0_token`;
  5. `verdict.sign(...)` → secp256k1 over `BCS(VerdictIntent{..})` (`coincurve`);
  6. submit `record_verified_inference` via `scripts/mpp-record.ts`;
  7. return `{ solution, judge0_token, pass_bps, verified, sui_pay_digest, usdc_pay_digest, record_digest, verified_receipt_id }`.

**Language split (deliberate, matches the request):** Python owns orchestration, the **Judge0 API call**,
scoring, and verdict signing; the two **Sui-signing legs** (USDC x402 payment + `record_verified_inference`)
go through a thin TS helper using `@t2000/sdk` + `@mysten/sui`, invoked by the service. (`pysui` is the
pure-Python alternative; TS chosen for SDK parity with the repo.)

**Network modes:** `MPP_MODE=mock` (canned 402→200 Judge0 responses, no real USDC — default, fully testnet,
self-contained demo) vs `MPP_MODE=live` (real MPP on Sui mainnet for the Judge0/USDC leg while the inference
market stays on testnet). Both exercise the same code path; only the HTTP/payment client swaps.

---

## 6. Frontend — Suilend-grade polish (`pollius_rl/app`)

Positioning target: **Suilend** — dense, professional, dark, data-first, wallet-first; numbers update live;
nothing feels like a toy. Reuse `Sparkline`, `VerifierPanel`, `ListingCard`, `wallet.tsx`, `useRegistry`.

- **`market.ts`** — add verifier `kind: "judge0"` (`{ kind, name: "Judge0", detail: "code executed in a
  sandbox, paid per run via MPP, verdict attested on Sui" }`) and a new sort-list listing beside the Lean one
  (two verifier kinds on screen). Extend `RunResult` with `judge0Token`, `usdcPayDigest`, `verifiedReceiptId`.
- **Markets dashboard (`app/market/page.tsx`)** — Suilend-style: a KPI band (Total Fee TVL = Σ env+registry
  pools, total calls, verified calls, avg pass-rate), filters by verifier kind, a dense table/grid of
  listings each showing model, env, price, current pass-rate + sparkline, verified-calls.
- **Listing detail (`app/market/[id]/page.tsx` + new `VerifiedRunPanel.tsx`)** — buy (wallet →
  `buy_inference`), then `/verify`; the panel surfaces the generated code, **Judge0 verdict
  (Accepted/Wrong Answer)**, the **re-runnable Judge0 token**, the **USDC-paid-to-MPP** digest, the on-chain
  `VerifiedReceipt` + `InferenceVerified`, and the Environment fee-pool tick. `Sparkline` = pass-rate history
  from `CheckpointPublished` events.
- **Portfolio (`app/portfolio/page.tsx`, new)** — the "position"/Suilend angle: the connected wallet's owned
  `Receipt` + `VerifiedReceipt` objects (your verified inferences), each with its task, pass verdict, and a
  one-click "re-verify in Judge0" using the stored token.

---

## 7. Demo flow (the 90-second wow)

1. **Markets dashboard**: Polius opens Suilend-style — Total Fee TVL, two environments (Lean / sort-list),
   the sort-list model badge reads **"v0 · pass 20%"**, sparkline flat at 20%.
2. **Buy #1**: connect wallet → "Run current model (0.1 SUI)" → `buy_inference` → `Receipt`. The verifier
   service generates v0's code, runs it in **Judge0 via MPP** (0.02 USDC, x402), scores it → **Wrong Answer →
   FAIL** (honest). `VerifiedReceipt` minted with the failing Judge0 token. Click the token → re-run in
   Judge0 → same failure (auditable).
3. **Improve**: the RL loop + orchestrator promote **v1 → v2 → v3** via `publish_checkpoint`; the dashboard
   pass-rate chart **climbs live** from `CheckpointPublished` events; the badge updates to "v3".
4. **Buy #2**: same task → served by **v3** → Judge0 → **Accepted → PASS**. New `VerifiedReceipt`; its Judge0
   token re-runs to a pass.
5. **Trace it**: portfolio shows both positions (FAIL v0, PASS v3); click through to `InferencePaid` /
   `InferenceVerified` txs on Suiscan, the USDC payment to MPP, and the LoRA blobs on Walruscan. The
   Environment `fee_pool` grew on every call.

Curated set spans difficulty: one easy task even v0 passes (baseline sanity) + one only the improved model
passes (the moving frontier).

---

## 8. Testing strategy

- **Move:** unit tests in `contracts/tests/inference_market_tests.move` (§4) — valid/forged/replayed verdict,
  key rotation; plus the existing buy/publish tests still pass.
- **Python:** `verifier_service` tests with a **fake MPP** (canned 402→200) + fake Sui RPC + monkeypatched
  generator; verdict signing round-trips to a known secp256k1 verify; scoring on hidden tests.
- **TS helper:** `mpp-record.ts` arg-encoding test (BCS field order matches the Move `VerdictIntent`).
- **E2E (manual):** scripted run on testnet — buy → verify (`MPP_MODE=mock`) → `VerifiedReceipt` appears in
  the portfolio; then one `MPP_MODE=live` run hitting real MPP/Judge0.

---

## 9. Architecture & reuse

| # | Unit | Responsibility | Location | Status |
|---|---|---|---|---|
| 1 | Move: verified inference | `verifier_pk`, `record_verified_inference`, `VerifiedReceipt`, `InferenceVerified` | `contracts/sources/inference_market.move`, `events.move` | extend |
| 2 | Verifier service | receipt-gate → generate → Judge0(MPP) → sign → record | `environments/verifier_service.py` (+ `mpp_judge0.py`, `verdict.py`) | new |
| 3 | On-chain submitter | USDC x402 pay + `record_verified_inference` | `scripts/mpp-record.ts` | new, small |
| 4 | Markets dashboard | Suilend-style KPI band + listings | `app/market/page.tsx` | extend |
| 5 | Verified run panel | buy→verify→verdict+token+digests | `app/market/[id]/page.tsx`, `app/components/VerifiedRunPanel.tsx` | extend/new |
| 6 | Portfolio | owned `Receipt`/`VerifiedReceipt` positions | `app/portfolio/page.tsx` | new |
| 7 | Demo orchestrator | seed v0→vN, promote on cadence | `environments/` or `pollius_demo` script | new, small |

**Reuse:** `pols_core::environment` (fee-pool + cap conventions), `pols_core::register`/`enclave`
(secp256k1 verify pattern → the verdict check; enclave key = the Nautilus upgrade seam), `@mysten/dapp-kit` +
Enoki wallet, `Sparkline`/`VerifierPanel`/`ListingCard`/`useRegistry`.

---

## 10. Open decisions (defaulted; flag to change)

1. **MPP network**: default `MPP_MODE=mock` for a self-contained testnet demo; real mainnet MPP/Judge0 behind
   the `live` flag. *(Resolves the mainnet-vs-testnet mismatch: inference market on testnet, MPP leg
   mock-by-default / mainnet-when-live.)*
2. **Submit language**: TS helper (`@t2000/sdk` + `@mysten/sui`) over `pysui`, for SDK parity.
3. **Verifier key custody**: per-registry `verifier_pk` set by the publisher (the RL/service operator), not a
   global verifier — keeps each model's grader explicit and the enclave-upgrade seam clean.

---

## 11. Stretch / upgrade path

- **Nautilus/TEE**: replace the bare `verifier_pk` with an `enclave.move` Nitro key — same `VerdictIntent`,
  now the verdict is TEE-attested. `set_verifier` is the seam.
- **Credit token** via `lib/token.ts`; **multi-task** free-form input once the verifier is hardened;
  **secondary market** for `Environment` ownership (the asset itself trades).
