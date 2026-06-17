# Lean Inference Market — Design

**Date:** 2026-06-17
**Status:** Approved (brainstorming) — ready for implementation plan
**Repos:** `pollius_rl` (Next.js + Move + Sui/Walrus glue) ↔ `pollius_demo_llm_post_training` (Python: RL + inference + publisher)

## 0. One-line thesis

A **pay-per-inference market for Lean theorem proving**: buyers pay on Sui to run the
current-best model on a curated theorem and get a **machine-checked proof**, while a
**background RL loop** (`spg.py` + LoRA) keeps promoting better checkpoints from
Walrus. Because quality is the Lean-verifier pass rate, "the model is self-improving"
is *provable on-screen*, not asserted.

## 1. Goals / non-goals

**Goals**
- Real on-chain pay-per-inference on **Sui testnet** (SUI into a fee pool, receipt issued).
- Real decentralized model storage: each checkpoint is a **LoRA adapter blob on Walrus**.
- Genuine background self-improvement using the existing `spg.py` solver loop.
- A demo where the *same curated theorem* visibly flips **FAIL → PASS** as the served
  model improves, with the on-chain `pass_rate` chart climbing live.

**Non-goals (scope cuts for the hackathon)**
- ❌ Free-form theorem input — **fixed/curated prompts only** (de-risks Lean parse + guarantees the FAIL→PASS arc).
- ❌ Real-time GPU RL as a hard requirement — the live loop runs, but a **seeded timeline of real checkpoints** guarantees the curve moves on cadence.
- ❌ Credit token (`lib/token.ts`) — pay directly in SUI (token is a stretch).
- ❌ TEE/enclave attestation in the core path — already built in `pols_core::enclave`, so it is a **stretch goal**; the payment `Receipt` is sufficient trust for the demo.
- ❌ Escrow/refunds, multi-model bidding, model routing — single current-best model only.

## 2. Architecture & reuse

Six units; units 3 and 5 **extend** existing `pollius_rl` code rather than build new.

| # | Unit | Responsibility | Repo / location | Status |
|---|------|----------------|-----------------|--------|
| 1 | RL Trainer (background) | `spg.py` solver loop + **LoRA**; eval pass_rate on held-out theorems; emit `(adapter_dir, pass_rate)` | `pollius_demo` | ~80% (add LoRA + emit hook) |
| 2 | Checkpoint Publisher | Walrus-store adapter → `blob_id`; Sui `publish_checkpoint` | `pollius_demo` script | new, small |
| 3 | Sui Move package | new module `pols_core::inference_market` (registry + pay) | `pollius_rl/contracts` | extend (mirror `environment`) |
| 4 | Inference Service | receipt-gate → load current-best adapter (Walrus) → generate → LeanVerifier → result + attestation | `pollius_demo` (FastAPI) | new wrapper around `TorchPolicy` + `LeanVerifier` |
| 5 | Buyer Web UI | wallet pay + run + proof ✓ + live self-improvement chart | `pollius_rl/app` | extend (reuse `Sparkline`, `ContractDemo`, wallet) |
| 6 | Demo Orchestrator | seed real v0→vN to Walrus+Sui; promote on cadence | `pollius_demo` script | new, small |

**Reuse map from `pollius_rl`:**
- `pols_core::environment` — shared object + `EnvironmentCap` + `fee_pool: Balance<SUI>` → conventions + fee-pool pattern for `inference_market`.
- `pols_core::register` + `enclave` — secp256k1 TEE attestation + `/api/verify-token` → stretch trust upgrade ("proof came from model vX").
- `@mysten/dapp-kit` + Enoki zkLogin → wallet connect / sign / pay (done).
- `Sparkline` (the chart), `TrainingPanel` / `AgentLoopVisual` (loop viz), `ContractDemo` / `DeployButton` (Move-call pattern), `wallet.tsx`.
- `lib/protocol.ts`, `lib/token.ts`, `scripts/` — Sui tx helpers + optional credit token.

## 3. Data flow

**Buyer path (synchronous):**
1. UI: pick a curated theorem → "Run current model (0.1 SUI)".
2. Wallet signs `inference_market::buy_inference(registry, theorem_id, coin)` → SUI into `fee_pool`, emits `InferencePaid{buyer, version, theorem_id, amount}`, transfers a `Receipt`.
3. UI → `POST /prove {theorem_id, payment_digest}` to the inference service.
4. Service: confirm payment on Sui → load current-best **LoRA adapter** (cached; pulled from Walrus by `blob_id` from `ModelRegistry`) → generate proof → **LeanVerifier** → `{proof, verified, version, pass_rate}`.
5. Service pins a proof **attestation to Walrus** (theorem + proof + verified + version) → `blob_id`.
6. UI shows proof, **Lean-verified ✓/✗**, "served by model v3 · pass 55%", Walrus + Sui links.

**Background path (continuous — the self-improvement):**
1. Trainer trains; every N steps evaluates **pass_rate** on a held-out theorem set.
2. On improvement → Publisher: Walrus-store adapter → `blob_id`; Sui `publish_checkpoint(cap, registry, blob_id, pass_rate_bps)` appends a version + advances `current_best`, emits `CheckpointPublished`.
3. UI subscribes to Sui events → chart climbs and "current model" badge updates live.
4. Demo Orchestrator pre-seeds real v0→vN checkpoints and promotes on cadence (live loop runs alongside).

**Honesty anchor:** the chart's `pass_rate` is the *same* number `LeanVerifier` computes in training and that buyers re-check on every proof.

## 4. On-chain objects (`pols_core::inference_market`, new module)

Mirrors `environment` conventions: `VERSION` gate, cap-gated mutation, events, `*_internal` private bodies.

```move
public struct ModelRegistry has key {        // shared commons
    id: UID,
    current_best: u64,                        // index into versions
    versions: vector<ModelVersion>,           // append-only checkpoint history
    fee_pool: Balance<SUI>,                    // buyer payments accrue here
    version: u64,
}
public struct ModelVersion has store {
    walrus_blob_id: String,                    // LoRA adapter on Walrus
    pass_rate_bps: u64,                        // verifier-measured, 0..10000
    published_at: u64,
}
public struct PublisherCap has key, store { id: UID, registry: ID }   // RL-side authority
public struct Receipt has key, store {                                // proof of payment
    id: UID, buyer: address, version: u64, theorem_id: u64, paid: u64,
}
```

**Entries**
- `create_registry(ctx) -> PublisherCap` — share `ModelRegistry`, return cap.
- `publish_checkpoint(cap, registry, blob_id, pass_rate_bps, clock)` — cap-gated; append `ModelVersion`, set `current_best`, emit `CheckpointPublished{version, blob_id, pass_rate_bps}`.
- `buy_inference(registry, theorem_id, payment: Coin<SUI>, ctx)` — deposit into `fee_pool`, emit `InferencePaid{buyer, version, theorem_id, amount}`, transfer `Receipt` to sender.

**Views:** `current_best`, `version_count`, `pass_rate_of(registry, v)`, `fee_pool_value`.

The inference service gates on either the returned `Receipt` object or the `InferencePaid` event (matched by buyer + theorem_id + recent digest).

## 5. Walrus layout

- **LoRA adapters:** one quilt/blob per checkpoint version (`adapter_model.safetensors` + `adapter_config.json`); `blob_id` recorded in the `ModelVersion`. Small (~MBs) → fast promotion.
- **Proof attestations:** one blob per paid inference: `{theorem_id, theorem, proof, verified, model_version, pass_rate, ts}`; `blob_id` surfaced in the UI (and optionally recorded on Sui).
- **Base model:** public `Qwen/Qwen2.5-0.5B-Instruct` — referenced, stored once at most (not per checkpoint).

## 6. Background RL integration

- Add **LoRA** to `TorchPolicy` (`peft.get_peft_model`), so checkpoints are tiny adapters.
- Add an **emit hook** to the trainer: every N steps, eval held-out pass_rate and write the adapter dir + pass_rate where the Publisher picks it up.
- **Publisher** (`pollius_demo` script): `walrus store-quilt` the adapter → `blob_id`; call `inference_market::publish_checkpoint` via `@mysten/sui` (TS) or the Sui CLI.
- The SGS outer loop (`spg.py` `ConjecturerTrainer` + `TransferRewardFn`) is the engine producing improvement; the market is downstream of its checkpoints.

## 7. Inference service API (`pollius_demo`, FastAPI)

- `GET /model` → `{version, pass_rate, walrus_blob_id}` (reads `ModelRegistry`).
- `POST /prove {theorem_id, payment_digest}` →
  - verify payment on Sui (receipt/event),
  - ensure current-best adapter is loaded (cache by blob_id),
  - generate proof for the curated `theorem_id`, run `LeanVerifier`,
  - pin attestation to Walrus,
  - return `{proof, verified, version, pass_rate, attestation_blob_id}`.
- Curated theorems live in a small server-side table keyed by `theorem_id` (reuse `data/lean_proof/*`).

## 8. UI changes (`pollius_rl/app`)

- New page `app/market/page.tsx` (or extend `app/agents`): curated theorem card(s), "current model" badge, **self-improvement `Sparkline`** fed by `CheckpointPublished` events, a "Run (0.1 SUI)" button (wallet → `buy_inference`), and a result panel (proof + ✓/✗ + version + Walrus/Sui links).
- Reuse `ContractDemo`/`DeployButton` patterns for the Move call; `wallet.tsx` for connect; existing Sui client config.

## 9. Demo flow (the 90-second wow)

1. Market page: badge "v0 · pass 20%", chart at 20%, curated theorem shown.
2. Buyer pays 0.1 SUI → served by **v0** → proof → Lean **✗ FAIL** (honest).
3. Background loop + orchestrator promote v1→v2→v3 — chart climbs **live** from Sui events.
4. Buyer pays again → served by **v3** → same theorem → Lean **✓ PASS**.
5. Click through: `InferencePaid` txs on Sui explorer; LoRA adapter blobs + proof attestation on Walrus.

Curated set spans difficulty: one easy theorem even v0 proves (baseline sanity) + one that only the improved model gets (the moving frontier).

## 10. Testing strategy

- **Move:** `contracts/tests` (mirror `world_tests.move`): `buy_inference` grows `fee_pool` + issues `Receipt`; `publish_checkpoint` appends version + advances `current_best`; cap mismatch aborts; version gate.
- **Python inference service:** payment-gate path + prove+verify path with fakes (reuse existing `FakePolicy`/monkeypatched `LeanVerifier` patterns); curated-theorem lookup.
- **Publisher:** Walrus-store + Sui-call wiring with fakes.
- **E2E (manual):** scripted run hitting `/prove` against a local registry on Sui testnet.

## 11. Open questions / stretch goals

- **TEE attestation (stretch):** wire `pols_core::enclave` so the inference service signs `{theorem, proof, version}` and the UI shows an attested badge.
- **Credit token (stretch):** route payment through `lib/token.ts` instead of raw SUI.
- **Marginal transfer credit (stretch):** snapshot/restore solver inside `inner_update` for per-checkpoint attribution.
- **Real `novelty_fn`** for the SGS `(1+β·novelty)` term.
- **Payment verification mode:** receipt-object check vs event-scan — pick receipt-object for determinism.
