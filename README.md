<div align="center">

# Polius

### Post-training creates the skill. The chain can't see it.

**Polius makes AI post-training _verifiable, ownable, and payable_ — on [Sui](https://sui.io).**
Prove a model is good, own the environment that made it good, and pay per call for
results anyone can re-check.

[![Live demo](https://img.shields.io/badge/demo-polius--rl.vercel.app-000?style=flat-square)](https://polius-rl.vercel.app)
[![Sui](https://img.shields.io/badge/Sui-Move%202024-4DA2FF?style=flat-square)](https://sui.io)
[![Walrus](https://img.shields.io/badge/storage-Walrus-1B1B1B?style=flat-square)](https://walrus.xyz)
[![TEE](https://img.shields.io/badge/TEE-Nautilus%20%2F%20AWS%20Nitro-FF9900?style=flat-square)](https://github.com/MystenLabs/nautilus)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat-square)](#license)

</div>

---

## The problem

Models earn their skill in **post-training** — RL, self-play, grading against a rubric.
Agents now do this autonomously. But that entire layer lives **off-chain and unprovable**:

- A `92% pass-rate` is a **claim, not a proof** — no seal, no attestation, nothing to re-check.
- The **environment** that produced the skill — the dataset and grader — isn't owned by anyone.
- When you pay for an inference, you get **a string you have to trust**.

## The solution

Polius turns each gap into an on-chain primitive. You don't buy a string — **you buy a result anyone can re-check.**

| Primitive | What it is | Module |
| --- | --- | --- |
| 🌍 **Environment** | A dataset + grader, uploaded to Walrus and registered as a shared Sui object with a fee pool. An owned `EnvironmentCap` is the tradable authority over it. | [`world.move`](contracts/sources/world.move) |
| 🔏 **EpochAttestation** | A pass-rate / mean-reward signed **inside a Nautilus TEE** (AWS Nitro enclave) and verified on-chain — bound to the environment that produced it. | [`env_verifier.move`](contracts/sources/env_verifier.move) · [`enclave.move`](contracts/sources/enclave.move) |
| 🧾 **VerifiedReceipt** | A per-call inference result, graded and settled in SUI/USDC, recorded against an on-chain `ModelRegistry`. Pay-per-call, re-checkable. | [`inference_market.move`](contracts/sources/inference_market.move) |

---

## How it works

```
   environment bundle                  pollius-env CLI                         on Sui
 ┌────────────────────┐      ┌──────────────────────────────┐      ┌───────────────────────────┐
 │ manifest.json      │  1   │ verify    dataset + grader   │      │  Environment    (shared)  │
 │ dataset.json       ├─────▶│ upload    → Walrus blob      ├─────▶│  EnvironmentCap (owned)   │
 │ reward.py (grader) │      │ register  → Environment      │      │  + fee pool               │
 └────────────────────┘      │ attest    → run 1 epoch in   │      ├───────────────────────────┤
                             │            a Nautilus TEE     ├─────▶│  EpochAttestation         │
                             └──────────────────────────────┘      │  (reward % · pass % ·     │
                                                                    │   attested_by nitro)      │
                                                                    └────────────┬──────────────┘
   marketplace (Next.js)                                                         │ lists
 ┌───────────────────────────────────────────────────────────────────┐          ▼
 │ browse models → run a sample inference → pay 0.1 SUI → verified     │   VerifiedReceipt
 │ output → on-chain registry updates (calls↑, fee pool↑)             │   settled on-chain
 └───────────────────────────────────────────────────────────────────┘
```

Everything that backs a claim is a public object: the **dataset on Walrus**, the
**attestation on Sui**, the **receipt on Sui**. Anyone can re-check.

---

## Quickstart

### Run the marketplace

```bash
git clone https://github.com/makimakiver/polius_rl.git
cd polius_rl
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev                        # http://localhost:3000
```

### Deploy an environment on-chain

The [`pollius-env`](packages/pollius-env) CLI runs the whole pipeline — verify → Walrus →
register → TEE-attested epoch — using your local Sui CLI keystore (it never touches private keys):

```bash
# deploy a bundle and mint an attested baseline epoch
npx pollius-env deploy examples/envs/lean-prover --epoch --name "Lean 4 Theorem Prover"
```

```
✓ Environment deployed on testnet
  env object  : 0xde75…                                  # shared Environment (anyone can read)
  artifact    : walrus://3Znq…                           # manifest blob → dataset + reward.py
  suiscan     : https://suiscan.xyz/testnet/object/0xde75…
  attestation : https://suiscan.xyz/testnet/object/0x9b79…   # minted with --epoch
```

It then appears in the marketplace under **On-chain environments**.

---

## Environment bundles

An environment is just a directory:

```
my-env/
  manifest.json   { "name", "description"?, "tags"?, "system"?, "grader"? }
  dataset.json    [ { "question": "...", "answer": "..." }, ... ]
  reward.py       (optional) grader code — uploaded to Walrus for transparency
```

Three runnable examples live in [`examples/envs/`](examples/envs):

| Example | Task | Grader |
| --- | --- | --- |
| [`lean-prover`](examples/envs/lean-prover) | Prove a Lean 4 theorem (sample model: Qwen2.5-0.5B) | real Lean 4 compiler — reward `1.0` iff it builds, no `sorry`/`admit` |
| [`sort-list`](examples/envs/sort-list) | Sort a list | exact-match |
| [`world-capitals`](examples/envs/world-capitals) | Answer capital-city questions | exact-match |

---

## Repository layout

```
contracts/            Move 2024 package `pols_core` — the on-chain primitives
  sources/
    world.move             Environment + EnvironmentCap (own the environment)
    env_verifier.move      EpochAttestation (prove a model is good)
    inference_market.move  ModelRegistry + VerifiedReceipt (pay per verified call)
    enclave.move           Nautilus / AWS Nitro TEE attestation verification
    register.move          on-chain agent registry
    events.move            shared event types
  tests/                 Move unit tests

packages/pollius-env/ the `pollius-env` CLI (npm)
app/                  Next.js 16 marketplace — /market, /deploy, /portfolio, /agents
  components/RegisterEnokiWallets.tsx   zkLogin via @mysten/enoki
examples/envs/        runnable environment bundles
scripts/              demo + ops tooling (demo.sh, withdraw, token issuance)
```

---

## Configuration

The app and CLI read from the environment (or a `.env.local`):

| Variable | Used by | Required | Default |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_PKG_ID` | app + CLI | yes | — |
| `NEXT_PUBLIC_SUI_NETWORK` | app + CLI | no | `testnet` |
| `NEXT_PUBLIC_MARKET_REGISTRY` | app | yes | — |
| `NEXT_PUBLIC_ENOKI_API_KEY` | app (zkLogin) | for sign-in | — |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | app (zkLogin) | for sign-in | — |
| `PY_VERIFIER_URL` | CLI | no | `http://localhost:8077` |
| `WALRUS_PUBLISHER` | CLI | no | testnet publisher |

> **zkLogin note:** `NEXT_PUBLIC_*` values are inlined at **build time**, and the OAuth
> redirect (`<origin>/auth/callback`) must be whitelisted in both the Google console and
> the Enoki portal for your deployed domain.

---

## Tech stack

**Chain** Sui (Move 2024) · **Storage** [Walrus](https://walrus.xyz) ·
**TEE** [Nautilus](https://github.com/MystenLabs/nautilus) / AWS Nitro enclaves ·
**Frontend** Next.js 16 · React 19 · [`@mysten/dapp-kit`](https://sdk.mystenlabs.com/dapp-kit) ·
[`@mysten/enoki`](https://docs.enoki.mystenlabs.com) zkLogin · **Settlement** SUI / USDC

---

## License

[MIT](#license) © Polius
