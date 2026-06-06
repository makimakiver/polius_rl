# Deploy Environment On-Chain — Design Spec

**Date:** 2026-06-06
**Status:** Approved (design)
**Scope:** First minimal feature of "let users actually operate the smart contracts from the frontend." Wires the existing `/deploy` form to a **real** `world::create_world_entry` transaction and introduces a central contract-config layer.

## Goal

Replace the fake "Sample UI — no transaction is broadcast" deploy flow with a real Sui transaction that creates and shares an on-chain `Environment`, returning its object ID and `EnvironmentCap` ID. Establish a reusable config layer so subsequent features (apply-action, mint, bind, step) build on the same foundation.

This is one feature in a feature-by-feature rollout. Out of scope here: any agent/registry/enclave flow, reading real envs into the dashboard, and persistence/indexing.

## Current State (verified)

- Contracts published to **Sui testnet**, package `0x22878c182f7b764e8ea3f97e943c421f5ef3781710f8965231cb070c366b1428` (`contracts/Published.toml`). Modules: `world`, `agent`, `register`, `enclave`, `decay`, `events`.
- Frontend: Next.js 16.2.7 + `@mysten/dapp-kit` ^1.0.6 + `@mysten/sui` ^2.17.0. **Wallet connect fully works** (`app/components/wallet.tsx`, `app/providers.tsx`, default network `testnet`).
- Everything contract-facing is **mocked**. `app/deploy/page.tsx` calls `setDeployed(id)` with a slug and explicitly broadcasts no transaction. `app/data/environments.ts` / `app/data/agents.ts` are hardcoded sample data. **Zero** `moveCall`/`Transaction` usages exist in the app today.

## Contract Reference

`world::create_world_entry` (in `contracts/sources/world.move`) is an `entry` function:

```move
entry fun create_world_entry(
    decay_bps_per_day: u64,
    floor: u64,
    ceil: u64,
    init_value: u64,
    clock: &Clock,
    ctx: &mut TxContext,
)
```

It builds a `decay::Config`, creates an `Environment` (a single decaying scalar world-value with floor/ceil/decay), **shares** it, transfers the `EnvironmentCap` to the sender, and emits `events::WorldCreated { env_id, owner }`. The on-chain object stores only these decay params — **no** RL hyperparameters.

`Clock` is the well-known shared object at `0x6`.

## Design

### 1. Config layer

`.env.local` (git-ignored; `.env*` already in `.gitignore`) holds public on-chain IDs, `NEXT_PUBLIC_`-prefixed so the client bundle can read them:

```
NEXT_PUBLIC_SUI_NETWORK=testnet
NEXT_PUBLIC_PACKAGE_ID=0x22878c182f7b764e8ea3f97e943c421f5ef3781710f8965231cb070c366b1428
NEXT_PUBLIC_AGENT_BOOK_ID=<discover from publish tx>
NEXT_PUBLIC_AGENT_REGISTRY_ID=<discover from publish tx>
NEXT_PUBLIC_CLOCK_ID=0x6
```

`app/config/contracts.ts` — typed wrapper that:
- Reads `process.env.NEXT_PUBLIC_*`.
- **Validates required keys** for *this* feature: `PACKAGE_ID`, `SUI_NETWORK`, `CLOCK_ID`. Throws a clear, actionable error if missing. `AGENT_BOOK_ID` / `AGENT_REGISTRY_ID` are included for forthcoming features but **not** required-validated yet (so a missing value doesn't block deploy).
- Exports a frozen `CONTRACTS` object: `{ packageId, network, clockId, agentBookId?, agentRegistryId? }`.
- Exports `target(module, fn)` → `` `${packageId}::${module}::${fn}` ``.

`.env.example` is committed documenting every key (placeholder values), since `.env.local` is git-ignored.

The `AGENT_BOOK_ID` / `AGENT_REGISTRY_ID` are discovered by inspecting the publish transaction's created shared objects (created in `agent::init` and `register::init`). Not blocking; captured opportunistically.

### 2. Deploy form changes (`app/deploy/page.tsx`)

Add a **"World parameters"** section above the existing RL sections, with four integer inputs:

| Field | State var | Default | Maps to |
|---|---|---|---|
| Decay rate (bps/day) | `decayBps` | `100` | `decay_bps_per_day: u64` |
| Floor | `floor` | `0` | `floor: u64` |
| Ceiling | `ceil` | `10000` | `ceil: u64` |
| Initial value | `initValue` | `5000` | `init_value: u64` |

- Short helper text per field (bps = basis points/day; floor is the delisting threshold).
- Existing RL fields (algorithm, observation/action space, hyperparameters, tags) remain **cosmetic preview only** — not sent on-chain.
- Validation (`canDeploy`): `name.trim().length > 1`; all four values parse to non-negative integers; `floor <= initValue <= ceil`. When invalid, submit is disabled and an inline message explains why.
- Right-hand live preview gains a line showing the four world params.

### 3. Transaction + result (`app/deploy/page.tsx`)

Replace the fake `setDeployed(id)` path:

1. Build the tx with `@mysten/sui/transactions`:
   ```ts
   const tx = new Transaction();
   tx.moveCall({
     target: target("world", "create_world_entry"),
     arguments: [
       tx.pure.u64(decayBps),
       tx.pure.u64(floor),
       tx.pure.u64(ceil),
       tx.pure.u64(initValue),
       tx.object(CONTRACTS.clockId),
     ],
   });
   ```
2. Execute via dapp-kit `useSignAndExecuteTransaction`, requesting `showEffects` + `showEvents`.
3. State machine: `idle → signing → success | error`. Submit button shows "Deploying…" and is disabled while pending.
4. On success: parse `effects.created` / the `WorldCreated` event to extract the shared **Environment object ID** and the **EnvironmentCap ID**. Success panel shows both as copyable mono strings plus a **Suiscan testnet** explorer link, replacing the fabricated slug. Keep "Deploy another" / "View dashboard" actions.
5. Error handling: distinct inline messages for wallet rejection vs. on-chain failure, reusing the error-styling pattern already in `app/components/wallet.tsx`.

## Error Handling

- Missing required env config → thrown at config-module load with a message naming the missing key and pointing at `.env.example`.
- Not connected → existing wallet-gate banner + `open()` modal (already present).
- Invalid form input → inline validation, submit disabled.
- Wallet rejection / tx failure → distinct inline error states; form remains editable for retry.

## Testing

- **Manual (primary):** connect a testnet wallet, deploy with defaults, confirm a real tx executes, the success panel shows real object IDs, and the explorer link resolves to a live `Environment` object. Verify validation blocks `floor > ceil` etc.
- **Config unit check:** `target()` composes correctly; missing-required-key throws.
- Per `AGENTS.md`, consult `node_modules/next/dist/docs/` for env-var / client-component specifics before coding (this is a modified Next.js).

## Scope Guardrails (YAGNI)

- No indexer, no reading real envs into the dashboard, no writing the new env back into `data/environments.ts` — just a real tx and an honest receipt.
- No agent/registry/enclave flow.
- No multi-network map; `.env`-driven single deployment is sufficient now.

## Follow-on Features (not this slice)

Apply-action (cap-gated `world::apply_action`), read live world state (`read_value` via devInspect), and the agent lifecycle (register → mint → bind → step) each build on this config layer in later feature slices.
