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

```bash
cd contracts && sui move test          # 12/12 green
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

## 5. What proves it's honest

- The `pass_bps` on the chart is the **same** number the RL loop optimizes and that buyers re-check.
- The verdict signature is verified on-chain (`secp256k1_verify`, single-hash) against the registry's
  `verifier_pk` — a forged or tampered verdict aborts (`E_BAD_VERDICT_SIG`); replays abort
  (`E_VERDICT_REPLAY`).
- The Python signer reproduces the on-chain-verified signature **byte-for-byte**
  (`test_signature_matches_onchain_vector`), so the Move ⇄ Python verdict contract is provably aligned.
