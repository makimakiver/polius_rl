# Polius — Verifiable Inference Market Demo Runbook

The 90-second story: **the same sort task goes FAIL → PASS as the served model improves**, and
every verdict is graded by **Judge0 (via MPP, paid in USDC on Sui)** and attested on-chain as a
`VerifiedReceipt` you can re-check by its Judge0 token.

```
Buyer pays SUI ─► ModelRegistry (70%) + Environment (30%)        revenue
Verifier pays 0.02 USDC ─► MPP/Judge0 (x402)                     cost of grading
Verdict + Judge0 token recorded on-chain (VerifiedReceipt)       the product delivered
RL loop publishes a better checkpoint                            the asset appreciates
```

## 0. Prerequisites

- `sui` CLI 1.70+ with a testnet address holding gas (`sui client active-address`, `sui client faucet`).
- Node 22, `npm install` done at repo root.
- `uv` in `environments/` (`cd environments && uv sync`).
- `.env.local` at repo root (copy from `.env.local.example`).

## 1. Publish the package + create the asset

> **Fund first:** publishing this 5-module package costs ~0.1 SUI. Top up the active address at
> https://faucet.sui.io (the CLI faucet is disabled). Check with `sui client gas`.
>
> **Fresh publish (required):** Phase A changed `ModelRegistry`'s layout, so this is a *new* package,
> not an upgrade. Remove the `[published.testnet]` block from `contracts/Published.toml` first (it is
> regenerated on success), otherwise publish aborts with "already published".

```bash
cd contracts && sui move test          # 12/12 green
# (remove the [published.testnet] entry from Published.toml — see note above)
sui client publish                     # no --gas-budget (see memory: deploy-no-gas-budget)
#   → record the new packageId  → NEXT_PUBLIC_PKG_ID
PKG=<packageId>

# Create the Environment asset (the on-chain D + verifier identity)
sui client call --package $PKG --module environment --function create_world_entry \
  --args "sort-list" "Sort integers ascending — Judge0-graded" "[]" "walrus://sort-env"
#   → record the shared Environment id → NEXT_PUBLIC_MARKET_ENV  (and keep the EnvironmentCap)

# Create the ModelRegistry bound to that env, with the verifier's secp256k1 pubkey.
# Demo key = the canonical test vector pubkey (sk = 0x01..0x20). Use a real key in prod.
sui client call --package $PKG --module inference_market --function create_registry_entry \
  --args $ENV_ID "0x0284bf7562262bbd6940085748f3be6afa52ae317155181ece31b66351ccffa4b0"
#   → record ModelRegistry id → NEXT_PUBLIC_MARKET_REGISTRY  (and the PublisherCap id → PUBLISHER_CAP_ID)
```

Set in `.env.local`:

```
NEXT_PUBLIC_PKG_ID=<packageId>
NEXT_PUBLIC_MARKET_ENV=<environmentId>
NEXT_PUBLIC_MARKET_REGISTRY=<registryId>
PUBLISHER_CAP_ID=<publisherCapId>
PY_VERIFIER_URL=http://localhost:8077
# verifier service (server-side)
SUI_RPC=https://fullnode.testnet.sui.io:443
SUI_SUBMITTER_SK=<suiprivkey... of the address that records verdicts (needs gas)>
VERIFIER_SK=0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20
MPP_MODE=mock            # 'live' hits real MPP/Judge0 on Sui mainnet (0.02 USDC/run)
```

> The `VERIFIER_SK` above is the demo test key; its pubkey is the one passed to `create_registry_entry`.
> For production, generate a fresh secp256k1 key, store the private half only in the service, and pass
> its 33-byte compressed pubkey to `create_registry` / rotate via `set_verifier`.

## 2. Bring up the stack

```bash
# terminal 1 — verifier service (mock Judge0, self-contained)
cd environments && uv run uvicorn verifier.service:app --port 8077

# terminal 2 — the app
npm run dev      # http://localhost:3000
```

## 3. The demo

1. **Markets dashboard** (`/market`): Suilend-style KPI band (Total Fee TVL, calls, verified calls,
   avg pass-rate). The **sort-list** listing shows the Judge0 verifier kind.
2. **Buy #1 at v0** — open `/market/sort-list`, connect wallet, **Run current model (0.1 SUI)**.
   - `buy_inference_entry` runs → `Receipt` minted.
   - The panel calls `/api/verify` → service generates v0's (wrong) program → runs it in Judge0 (mock)
     → **✗ FAIL**, a `mock_…` Judge0 token, and a `VerifiedReceipt` recorded on-chain.
   - Click the token to see the failing output is reproducible.
3. **Promote the model** (terminal 3):
   ```bash
   cd environments && PROMOTE_CADENCE_S=10 uv run python -m verifier.orchestrator
   ```
   Watch the dashboard pass-rate climb live from `CheckpointPublished` events as v1→v2→v3 publish.
4. **Buy #2 at v3** — Run again on the same task → service generates the correct program → Judge0 →
   **✓ PASS**, new `VerifiedReceipt`.
5. **Portfolio + trace** (`/portfolio`): both positions (FAIL v0, PASS v3). Click through to
   `InferencePaid` / `InferenceVerified` txs on Suiscan, the LoRA blobs on Walruscan, and — in
   `MPP_MODE=live` — the 0.02 USDC payment to the MPP gateway.

## 4. Going live (real Judge0 via MPP)

Set `MPP_MODE=live`. The verifier service then POSTs to `https://mpp.t2000.ai/judge0/v1/submissions`,
receives `402`, settles **0.02 USDC on Sui mainnet** via the x402 handshake (`@t2000/sdk`), retries,
and gets a real Judge0 execution result + token. Everything else is identical — the on-chain
`VerifiedReceipt` now references a real Judge0 submission anyone can re-run.

## 4b. Executed run — localnet proof (2026-06-20)

The full loop was executed end-to-end on a live local Sui network (`sui start --with-faucet
--force-regenesis`, chain `ee2ae89f`, RPC `:9000`, faucet `:9123`) — every step is a real on-chain
transaction, not a simulation. Reproduce with `sui client switch --env localnet` + the commands above
(use `sui client test-publish --build-env testnet` for the localnet publish).

| Object | Id |
|---|---|
| package | `0xa2013b61bd12f78ad5d9d67e4768dd73be7f6b4217ab28647caa7ab53ae704f7` |
| Environment (sort-list) | `0xd99c79cc9668225c27711dc1e54eb39c4aa511884f5b14891b9721e750988520` |
| ModelRegistry | `0x4f001a6ba881bf6cab5accedc21c7850cb73b3a8b47807cb6d4b3e75f2dcb6e4` |
| VerifiedReceipt — **v0 FAIL** (pass 0%) | `0xebcffca0c7e92856c13e95ae77de28f7d51c746aa4cde13afd3abb8232c32a2e` |
| VerifiedReceipt — **v3 PASS** (pass 100%) | `0x7a7b56b30a2fa0cdf20800cdb355974323d89ac2fe5bba7ba3782c07e3afc739` |

Outcome (read live from the registry):

```
buy #1 → served v0 → Judge0 → Wrong Answer → FAIL  → VerifiedReceipt pass_bps=0
promote v1→v2→v3 (publish_checkpoint)              → current_best=3, pass_rate=10000
buy #2 → served v3 → Judge0 → "-3 -3 0 5 5 9" ✓    → VerifiedReceipt pass_bps=10000
final: verified_calls=2 · last_pass_bps=10000 · registry fee_pool=0.14 SUI · env fee_pool=0.06 SUI
```

The on-chain `secp256k1_verify` accepted **live, per-call signatures** (not the static test vector) over
the real verdict fields — proving the verifier service's signer round-trips against the deployed contract.

## 4c. Real LLM inference (REAL_LLM=1)

By default the verifier serves a **deterministic stand-in** program (honestly reported as
`generator: "stand-in"` in `/verify` and shown as "stand-in (no model)" in the UI). To sell *real*
trained-LLM inference, run the service with the model:

```bash
cd environments
REAL_LLM=1 LLM_MODEL_DIR=/Users/makimakiver/qwen-0.5b PYTHONPATH=. \
  MPP_MODE=mock SUBMIT_MODE=client \
  NEXT_PUBLIC_PKG_ID=$PKG NEXT_PUBLIC_MARKET_REGISTRY=$REGISTRY \
  python3 -m uvicorn verifier.service:app --port 8077    # python with torch+transformers+peft
# optional trained adapter:  LLM_ADAPTER_DIR=/path/to/adapter_out
```

Then `/verify` loads Qwen-0.5B and **generates** the served program (`generator: "qwen-0.5b"`), which
Judge0 executes and grades for real. Observed live (greedy, CPU, ~3–10s/gen):

```
task 7 (sort, negatives+duplicates) → model writes a correct sort_ascending() → Judge0 Accepted → PASS
task 1 (easy ascending)             → model emits an incomplete program (defines fn, no stdin wiring) → FAIL
```

**Honest scope:** the served output is now genuine model inference. The multi-version *self-improvement
curve* for the sort env remains **illustrative** — there are no sort-trained checkpoints on hand (the
on-disk LoRA is Lean-trained and does not change the sort output). The real *trained-checkpoint*
improvement lives in the companion SGS Lean prover (`pollius_demo_llm_post_training`), which is what the
`lean-prover` listing represents.

## 5. What proves it's honest

- The `pass_bps` on the chart is the **same** number the RL loop optimizes and that buyers re-check.
- The verdict signature is verified on-chain (`secp256k1_verify`, single-hash) against the registry's
  `verifier_pk` — a forged or tampered verdict aborts (`E_BAD_VERDICT_SIG`); replays abort
  (`E_VERDICT_REPLAY`).
- The Python signer reproduces the on-chain-verified signature **byte-for-byte**
  (`test_signature_matches_onchain_vector`), so the Move ⇄ Python verdict contract is provably aligned.
