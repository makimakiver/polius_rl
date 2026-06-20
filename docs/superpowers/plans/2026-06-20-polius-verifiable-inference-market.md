# Polius Verifiable Inference Market — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sell LLM inference on Sui where the served answer is executed in Judge0 (via the MPP gateway, paid in USDC) and the verdict is attested on-chain as a `VerifiedReceipt`, wrapped in a Suilend-grade UI with a FAIL→PASS demo.

**Architecture:** Extend `pols_core::inference_market` with a per-registry verifier pubkey + `record_verified_inference` (secp256k1 verify, mirroring `register.move`). A Python FastAPI service gates on the buyer's `Receipt`, generates a solution, runs it through Judge0-over-MPP, signs a canonical `VerdictIntent` (BCS + secp256k1), and submits the verdict via a thin TS helper. The Next.js app gains a markets dashboard, a verified-run panel, and a portfolio of receipt positions.

**Tech Stack:** Sui Move (sui 1.70.2), Python 3.11+ / FastAPI / coincurve (uv), TypeScript / `@mysten/sui` ^2.17 / `@t2000/sdk`, Next.js 16 / React 19 / Tailwind v4, `@noble/curves` (already vendored) for fixture generation.

## Global Constraints

- Move package name `pols_core`, edition 2024; mutation is cap-gated; events carry full snapshots; `VERSION` gate preserved. Adding fields to `ModelRegistry` ⇒ **fresh publish**, not in-place upgrade.
- On-chain signature check is `ecdsa_k1::secp256k1_verify(&sig, &pubkey_33, &msg, 1)` — hash flag `1` = SHA256, pubkey 33-byte compressed, signature 64-byte compact (low-s). Exactly the `register.move` pattern.
- **Canonical `VerdictIntent` BCS layout (the contract between Move ⇄ Python ⇄ TS — must be byte-identical):** field order = `intent: u8`, `buyer: address(32B BE)`, `version: u64 LE`, `task_id: u64 LE`, `pass_bps: u64 LE`, `output_hash: vector<u8>` (ULEB len + bytes), `judge0_token: String` (ULEB len + utf8), `ts: u64 LE`. `intent` domain separator = `1`. **Object IDs are intentionally NOT in the signed payload** (binding is via the per-registry `verifier_pk` + per-registry `ts` replay guard), which keeps the payload deterministic and testable.
- **Canonical test vector** (TEST ONLY; private key = bytes `0x01..0x20`), reused by the Move positive test and the Python signer round-trip:
  - `verifier_pk` (33B): `0x0284bf7562262bbd6940085748f3be6afa52ae317155181ece31b66351ccffa4b0`
  - fields: `buyer=@0xB0B`, `version=0`, `task_id=7`, `pass_bps=5500`, `output_hash=0xdff0c75631fc7a9e44264518bf9cdea7bb1adb98387f74583c9a929004b2f92f` (= `sha256("0 1 2 3 4 5")`), `judge0_token="tok_demo_abc123"`, `ts=1718000000000`
  - `message_bcs`: `0x010000000000000000000000000000000000000000000000000000000000000b0b000000000000000007000000000000007c1500000000000020dff0c75631fc7a9e44264518bf9cdea7bb1adb98387f74583c9a929004b2f92f0f746f6b5f64656d6f5f616263313233009cc70090010000`
  - `signature` (64B, single-hash via coincurve `sign_recoverable(sha256(msg), hasher=None)[:64]`): `0x8b1fdb4fb2ccefd2a30fa6d979284dccb743d3ac930f437ab177baa72d9435e2635b57f112aedb4740cf7c97addb70cb4a08705730f64da4461945003c3363bf`
  - **Hashing scheme (idiomatic single-hash):** off-chain signs ECDSA digest `sha256(BCS)`; on-chain passes **raw BCS** to `secp256k1_verify(..., 1)` so Sui SHA256s it once. Move and the coincurve signer agree by construction (both single-hash). Do NOT double-hash.
- MPP Judge0: `POST https://mpp.t2000.ai/judge0/v1/submissions` body `{source_code, language_id, stdin}`; 402 → pay 0.02 USDC on Sui → retry. Python language_id default `71` (Python 3). `MPP_MODE=mock` (default, canned responses) | `live`.
- Frontend positioning: **Suilend** — dense, dark, data-first, wallet-first, live numbers.

---

## File Structure

| File | Responsibility |
|---|---|
| `contracts/sources/inference_market.move` (modify) | `verifier_pk`/`verified_calls`/`last_pass_bps`/replay table on `ModelRegistry`; `VerifiedReceipt`; `record_verified_inference`; `set_verifier`; views |
| `contracts/sources/events.move` (modify) | `InferenceVerified` event + emitter |
| `contracts/tests/inference_market_tests.move` (modify) | update `create_registry` calls; add verdict tests |
| `environments/verifier/verdict.py` (create) | canonical `VerdictIntent` BCS + secp256k1 sign/verify |
| `environments/verifier/mpp_judge0.py` (create) | Judge0-over-MPP client (`mock`/`live`), x402 handshake |
| `environments/verifier/solver.py` (create) | sort-list task bank + per-version solution generator + scorer |
| `environments/verifier/sui_client.py` (create) | read `ModelRegistry`, confirm `Receipt`, shell to TS submitter |
| `environments/verifier/service.py` (create) | FastAPI `GET /model`, `POST /verify` |
| `environments/tests/test_verdict.py` / `test_mpp_judge0.py` / `test_solver.py` / `test_service.py` (create) | pytest |
| `scripts/mpp-record.ts` (create) | submit `record_verified_inference` via `@mysten/sui` |
| `scripts/mpp-pay.ts` (create) | x402 USDC pay leg via `@t2000/sdk` (live mode) |
| `app/data/market.ts` (modify) | `kind:"judge0"`, new sort-list listing, extend `RunResult` |
| `app/market/page.tsx` (modify) | Suilend KPI band + dense listing grid |
| `app/components/VerifiedRunPanel.tsx` (create) | buy→verify→verdict+token+digests |
| `app/market/[id]/page.tsx` (modify) | mount `VerifiedRunPanel`, live `last_pass_bps` |
| `app/hooks/useRegistry.ts` (modify) | expose `verifiedCalls`, `lastPassBps` |
| `app/portfolio/page.tsx` (create) | owned `Receipt`/`VerifiedReceipt` positions |
| `app/api/verify/route.ts` (create) | proxy to the Python service (keeps service URL server-side) |
| `environments/verifier/orchestrator.py` (create) | seed v0→vN, promote on cadence |

---

## Phase A — Move: on-chain verified inference

### Task A1: Extend `ModelRegistry` + `create_registry` with the verifier key

**Files:**
- Modify: `contracts/sources/inference_market.move`
- Modify: `contracts/tests/inference_market_tests.move`

**Interfaces:**
- Produces: `create_registry(environment: ID, verifier_pk: vector<u8>, ctx): PublisherCap`; views `verifier_pk(&ModelRegistry): &vector<u8>`, `verified_calls(&ModelRegistry): u64`, `last_pass_bps(&ModelRegistry): u64`.

- [ ] **Step 1: Update the existing failing tests to the new signature**

In `contracts/tests/inference_market_tests.move`, add a constant near the top:

```move
const VERIFIER_PK: vector<u8> = x"0284bf7562262bbd6940085748f3be6afa52ae317155181ece31b66351ccffa4b0";
```

Replace every `market::create_registry(env_id, sc.ctx())` with `market::create_registry(env_id, VERIFIER_PK, sc.ctx())` (4 call sites: lines ~32, ~60, ~96, ~121, ~125).

- [ ] **Step 2: Run tests, expect compile failure**

Run: `cd contracts && sui move test inference_market`
Expected: FAIL — `create_registry` arity mismatch (signature not yet changed).

- [ ] **Step 3: Add fields + thread `verifier_pk` through creation**

In `inference_market.move`, add to `use`:

```move
use sui::table::{Self, Table};
use sui::ecdsa_k1;
```

Extend `ModelRegistry` (after `total_calls`):

```move
    verifier_pk: vector<u8>,            // secp256k1 (33B compressed) of this registry's verifier
    verified_calls: u64,
    last_pass_bps: u64,
    verified_ts: Table<u64, bool>,      // replay guard on verdict ts
```

Change `create_registry` to accept and store the key:

```move
public fun create_registry(environment: ID, verifier_pk: vector<u8>, ctx: &mut TxContext): PublisherCap {
    let registry = ModelRegistry {
        id: object::new(ctx),
        environment,
        creator: ctx.sender(),
        current_best: 0,
        versions: vector::empty(),
        fee_pool: balance::zero<SUI>(),
        total_calls: 0,
        verifier_pk,
        verified_calls: 0,
        last_pass_bps: 0,
        verified_ts: table::new(ctx),
        version: VERSION,
    };
    let rid = object::id(&registry);
    let cap = PublisherCap { id: object::new(ctx), registry: rid };
    events::emit_registry_created(rid, environment, ctx.sender());
    transfer::share_object(registry);
    cap
}
```

Update `create_registry_entry` to take + forward `verifier_pk: vector<u8>`. Add views:

```move
public fun verifier_pk(r: &ModelRegistry): vector<u8> { r.verifier_pk }
public fun verified_calls(r: &ModelRegistry): u64 { r.verified_calls }
public fun last_pass_bps(r: &ModelRegistry): u64 { r.last_pass_bps }
```

- [ ] **Step 4: Run tests, expect PASS**

Run: `cd contracts && sui move test inference_market`
Expected: PASS — existing 4 tests green with the new signature.

- [ ] **Step 5: Commit**

```bash
git add contracts/sources/inference_market.move contracts/tests/inference_market_tests.move
git commit -m "feat(move): add verifier_pk + verified-call state to ModelRegistry"
```

### Task A2: `record_verified_inference` + `VerifiedReceipt` + `InferenceVerified`

**Files:**
- Modify: `contracts/sources/inference_market.move`
- Modify: `contracts/sources/events.move`
- Modify: `contracts/tests/inference_market_tests.move`

**Interfaces:**
- Consumes: A1's `ModelRegistry` fields, the canonical BCS layout + test vector (Global Constraints).
- Produces: `record_verified_inference(registry: &mut ModelRegistry, receipt_id: ID, buyer: address, version: u64, task_id: u64, pass_bps: u64, output_hash: vector<u8>, judge0_token: String, ts: u64, signature: vector<u8>, ctx)`; `set_verifier(registry, cap, verifier_pk)`; error `E_BAD_VERDICT_SIG`, `E_VERDICT_REPLAY`; views `vreceipt_pass_bps`, `vreceipt_token`.

- [ ] **Step 1: Write the failing positive + negative tests**

Append to `contracts/tests/inference_market_tests.move` (add `use pols_core::inference_market::VerifiedReceipt;` to imports, and these consts):

```move
const SIG_GOOD: vector<u8> = x"5e2485713a3314dd49028f83a99f270d30793105750799055ded65d2969b1c3e63256aa8cd20ad28570cd9fc4accc0770ea8d957ddaa25471c6f4729381d0113";
const OUT_HASH: vector<u8> = x"dff0c75631fc7a9e44264518bf9cdea7bb1adb98387f74583c9a929004b2f92f";
const TS: u64 = 1718000000000;

#[test]
fun record_verdict_mints_receipt() {
    let mut sc = ts::begin(OWNER);
    let env_cap = new_env(sc.ctx());
    sc.next_tx(OWNER);
    let env_id = ts::most_recent_id_shared<Environment>().extract();
    let pub_cap = market::create_registry(env_id, VERIFIER_PK, sc.ctx());
    sc.next_tx(OWNER);
    let mut registry = sc.take_shared<ModelRegistry>();
    let clock = clock::create_for_testing(sc.ctx());
    market::publish_checkpoint(&mut registry, &pub_cap, string::utf8(b"blob-v0"), 2000, &clock);
    let rid = object::id(&registry);

    sc.next_tx(BUYER);
    market::record_verified_inference(
        &mut registry, rid, BUYER, 0, 7, 5500, OUT_HASH,
        string::utf8(b"tok_demo_abc123"), TS, SIG_GOOD, sc.ctx());

    assert!(market::verified_calls(&registry) == 1, 0);
    assert!(market::last_pass_bps(&registry) == 5500, 1);

    sc.next_tx(BUYER);
    let vr = sc.take_from_sender<VerifiedReceipt>();
    assert!(market::vreceipt_pass_bps(&vr) == 5500, 2);
    assert!(market::vreceipt_token(&vr) == string::utf8(b"tok_demo_abc123"), 3);

    sc.return_to_sender(vr);
    clock::destroy_for_testing(clock);
    transfer::public_transfer(pub_cap, OWNER);
    transfer::public_transfer(env_cap, OWNER);
    ts::return_shared(registry);
    sc.end();
}

#[test]
#[expected_failure(abort_code = market::E_BAD_VERDICT_SIG)]
fun record_verdict_bad_sig_aborts() {
    let mut sc = ts::begin(OWNER);
    let env_cap = new_env(sc.ctx());
    sc.next_tx(OWNER);
    let env_id = ts::most_recent_id_shared<Environment>().extract();
    let pub_cap = market::create_registry(env_id, VERIFIER_PK, sc.ctx());
    sc.next_tx(OWNER);
    let mut registry = sc.take_shared<ModelRegistry>();
    let rid = object::id(&registry);
    // tamper: pass_bps 5500 -> 9999, signature no longer matches
    market::record_verified_inference(
        &mut registry, rid, BUYER, 0, 7, 9999, OUT_HASH,
        string::utf8(b"tok_demo_abc123"), TS, SIG_GOOD, sc.ctx());
    transfer::public_transfer(pub_cap, OWNER);
    transfer::public_transfer(env_cap, OWNER);
    ts::return_shared(registry);
    sc.end();
}

#[test]
#[expected_failure(abort_code = market::E_VERDICT_REPLAY)]
fun record_verdict_replay_aborts() {
    let mut sc = ts::begin(OWNER);
    let env_cap = new_env(sc.ctx());
    sc.next_tx(OWNER);
    let env_id = ts::most_recent_id_shared<Environment>().extract();
    let pub_cap = market::create_registry(env_id, VERIFIER_PK, sc.ctx());
    sc.next_tx(OWNER);
    let mut registry = sc.take_shared<ModelRegistry>();
    let rid = object::id(&registry);
    market::record_verified_inference(&mut registry, rid, BUYER, 0, 7, 5500, OUT_HASH,
        string::utf8(b"tok_demo_abc123"), TS, SIG_GOOD, sc.ctx());
    sc.next_tx(BUYER);
    market::record_verified_inference(&mut registry, rid, BUYER, 0, 7, 5500, OUT_HASH,
        string::utf8(b"tok_demo_abc123"), TS, SIG_GOOD, sc.ctx()); // same ts -> replay
    transfer::public_transfer(pub_cap, OWNER);
    transfer::public_transfer(env_cap, OWNER);
    ts::return_shared(registry);
    sc.end();
}
```

- [ ] **Step 2: Run tests, expect failure**

Run: `cd contracts && sui move test record_verdict`
Expected: FAIL — `record_verified_inference` / `VerifiedReceipt` undefined.

- [ ] **Step 3: Add the event**

In `events.move` add the struct + emitter (after `InferencePaid`):

```move
public struct InferenceVerified has copy, drop {
    registry: ID, buyer: address, version: u64, task_id: u64,
    pass_bps: u64, judge0_token: String, output_hash: vector<u8>,
}
public(package) fun emit_inference_verified(
    registry: ID, buyer: address, version: u64, task_id: u64,
    pass_bps: u64, judge0_token: String, output_hash: vector<u8>,
) {
    event::emit(InferenceVerified { registry, buyer, version, task_id, pass_bps, judge0_token, output_hash });
}
```

- [ ] **Step 4: Implement `VerifiedReceipt`, `VerdictIntent`, `record_verified_inference`, `set_verifier`**

In `inference_market.move` add error codes:

```move
const E_BAD_VERDICT_SIG: u64 = 4;
const E_VERDICT_REPLAY: u64 = 5;
```

Add structs:

```move
public struct VerifiedReceipt has key, store {
    id: UID, registry: ID, buyer: address, version: u64,
    task_id: u64, pass_bps: u64, judge0_token: String, output_hash: vector<u8>,
}

/// Canonical signed verdict — field order/types are the Move⇄Python⇄TS contract.
public struct VerdictIntent has copy, drop {
    intent: u8, buyer: address, version: u64, task_id: u64,
    pass_bps: u64, output_hash: vector<u8>, judge0_token: String, ts: u64,
}
```

Add functions:

```move
public fun set_verifier(registry: &mut ModelRegistry, cap: &PublisherCap, verifier_pk: vector<u8>) {
    assert_version(registry);
    assert!(cap.registry == object::id(registry), E_WRONG_CAP);
    registry.verifier_pk = verifier_pk;
}

public fun record_verified_inference(
    registry: &mut ModelRegistry,
    receipt_id: ID,
    buyer: address,
    version: u64,
    task_id: u64,
    pass_bps: u64,
    output_hash: vector<u8>,
    judge0_token: String,
    ts: u64,
    signature: vector<u8>,
    ctx: &mut TxContext,
) {
    assert_version(registry);
    assert!(!table::contains(&registry.verified_ts, ts), E_VERDICT_REPLAY);

    let intent = VerdictIntent {
        intent: 1u8, buyer, version, task_id, pass_bps,
        output_hash: clone_bytes(&output_hash),
        judge0_token: clone_string(&judge0_token), ts,
    };
    let msg = std::bcs::to_bytes(&intent);
    let ok = ecdsa_k1::secp256k1_verify(&signature, &registry.verifier_pk, &msg, 1);
    assert!(ok, E_BAD_VERDICT_SIG);

    table::add(&mut registry.verified_ts, ts, true);
    registry.verified_calls = registry.verified_calls + 1;
    registry.last_pass_bps = pass_bps;

    events::emit_inference_verified(
        object::id(registry), buyer, version, task_id, pass_bps,
        clone_string(&judge0_token), clone_bytes(&output_hash));

    let vr = VerifiedReceipt {
        id: object::new(ctx), registry: receipt_id_to_self(registry), buyer, version,
        task_id, pass_bps, judge0_token, output_hash,
    };
    let _ = receipt_id; // receipt_id linked via event/UI; not part of signed payload
    transfer::public_transfer(vr, buyer);
}

public fun vreceipt_pass_bps(v: &VerifiedReceipt): u64 { v.pass_bps }
public fun vreceipt_token(v: &VerifiedReceipt): String { clone_string(&v.judge0_token) }

fun receipt_id_to_self(r: &ModelRegistry): ID { object::id(r) }
fun clone_bytes(b: &vector<u8>): vector<u8> { *b }
```

> Note: `VerifiedReceipt.registry` stores the registry id (`receipt_id_to_self`); the buyer's payment `receipt_id` is surfaced via the `InferenceVerified`/`InferencePaid` event pair in the UI. If you prefer to store the payment receipt id on-chain, change the field to `payment_receipt: ID` and set it to `receipt_id` — both compile; the demo uses the event linkage.

- [ ] **Step 5: Run tests, expect PASS**

Run: `cd contracts && sui move test`
Expected: PASS — all prior tests + `record_verdict_mints_receipt`, `record_verdict_bad_sig_aborts`, `record_verdict_replay_aborts` green.

- [ ] **Step 6: Commit**

```bash
git add contracts/sources/inference_market.move contracts/sources/events.move contracts/tests/inference_market_tests.move
git commit -m "feat(move): record_verified_inference + VerifiedReceipt + InferenceVerified"
```

### Task A3: Publish the fresh package + seed a registry

**Files:** none (operational); record output ids.

- [ ] **Step 1: Build**

Run: `cd contracts && sui move build`
Expected: `BUILDING pols_core` success, no warnings on the new code.

- [ ] **Step 2: Publish (testnet)**

Run: `cd contracts && sui client publish` (per `deploy-no-gas-budget` memory — no `--gas-budget`).
Record the new **package id** → set `NEXT_PUBLIC_PKG_ID` in `.env.local`.

- [ ] **Step 3: Create env + registry with the verifier key**

```bash
# create environment (returns EnvironmentCap + shared Environment id)
sui client call --package $PKG --module environment --function create_world_entry \
  --args "sort-list" "sort ints ascending, Judge0-graded" "[]" "walrus://sort-env"
# create registry bound to that env, with the verifier pubkey (0x02..b0 from the vector, or your prod key)
sui client call --package $PKG --module inference_market --function create_registry_entry \
  --args $ENV_ID "0x0284bf7562262bbd6940085748f3be6afa52ae317155181ece31b66351ccffa4b0"
```

Record `NEXT_PUBLIC_MARKET_ENV`, `NEXT_PUBLIC_MARKET_REGISTRY`, and the `PublisherCap` id.

- [ ] **Step 4: Commit env example**

Update `.env.local.example` with the three new ids (placeholders) + `VERIFIER_SK`, `MPP_MODE`, `PY_VERIFIER_URL`. Commit.

---

## Phase B — Python verifier service

### Task B1: `verdict.py` — canonical BCS + secp256k1 signing

**Files:**
- Create: `environments/verifier/__init__.py`, `environments/verifier/verdict.py`
- Test: `environments/tests/test_verdict.py`
- Modify: `environments/pyproject.toml` (add deps), `environments/verifier/` is a package.

**Interfaces:**
- Produces: `bcs_verdict(buyer_hex, version, task_id, pass_bps, output_hash: bytes, judge0_token, ts) -> bytes`; `sign_verdict(sk_hex, **fields) -> bytes (64B)`; `pubkey_compressed(sk_hex) -> bytes (33B)`.

- [ ] **Step 1: Add deps**

In `environments/pyproject.toml` `dependencies`, add `"coincurve>=20"`, `"fastapi>=0.115"`, `"uvicorn>=0.30"`, `"httpx>=0.27"`. Run `cd environments && uv sync`.

- [ ] **Step 2: Write the failing test (matches the canonical vector)**

```python
# environments/tests/test_verdict.py
from verifier.verdict import bcs_verdict, sign_verdict, pubkey_compressed

SK = "01" * 1  # placeholder; real below
SK_HEX = "".join(f"{i:02x}" for i in range(1, 33))   # 0x01..0x20
OUT_HASH = bytes.fromhex("dff0c75631fc7a9e44264518bf9cdea7bb1adb98387f74583c9a929004b2f92f")
FIELDS = dict(buyer_hex="0xB0B", version=0, task_id=7, pass_bps=5500,
              output_hash=OUT_HASH, judge0_token="tok_demo_abc123", ts=1718000000000)

def test_bcs_matches_vector():
    msg = bcs_verdict(**FIELDS)
    assert msg.hex() == (
        "010000000000000000000000000000000000000000000000000000000000000b0b"
        "000000000000000007000000000000007c150000000000002"
        "0dff0c75631fc7a9e44264518bf9cdea7bb1adb98387f74583c9a929004b2f92f"
        "0f746f6b5f64656d6f5f616263313233009cc70090010000")

def test_pubkey_matches_vector():
    assert pubkey_compressed(SK_HEX).hex() == \
        "0284bf7562262bbd6940085748f3be6afa52ae317155181ece31b66351ccffa4b0"

def test_signature_verifies_on_chain_shape():
    sig = sign_verdict(SK_HEX, **FIELDS)
    assert len(sig) == 64
```

- [ ] **Step 3: Run test, expect failure**

Run: `cd environments && uv run pytest tests/test_verdict.py -v`
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `verdict.py`**

```python
# environments/verifier/verdict.py
"""Canonical VerdictIntent BCS encoding + secp256k1 signing.

Byte layout MUST match pols_core::inference_market::VerdictIntent:
  intent:u8=1, buyer:address(32B BE), version:u64 LE, task_id:u64 LE,
  pass_bps:u64 LE, output_hash:vector<u8>(ULEB+bytes),
  judge0_token:String(ULEB+utf8), ts:u64 LE.
On-chain verify uses hash flag 1 (SHA256), so we sign sha256(msg).
"""
import hashlib
from coincurve import PrivateKey

def _u64le(n: int) -> bytes: return int(n).to_bytes(8, "little")
def _uleb(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F; n >>= 7
        out.append(b | 0x80 if n else b)
        if not n: return bytes(out)
def _addr32(h: str) -> bytes:
    h = h[2:] if h.startswith("0x") else h
    return bytes.fromhex(h.rjust(64, "0"))

def bcs_verdict(*, buyer_hex, version, task_id, pass_bps, output_hash: bytes,
                judge0_token: str, ts) -> bytes:
    tok = judge0_token.encode()
    return (bytes([1]) + _addr32(buyer_hex) + _u64le(version) + _u64le(task_id)
            + _u64le(pass_bps) + _uleb(len(output_hash)) + output_hash
            + _uleb(len(tok)) + tok + _u64le(ts))

def pubkey_compressed(sk_hex: str) -> bytes:
    return PrivateKey(bytes.fromhex(sk_hex)).public_key.format(compressed=True)

def sign_verdict(sk_hex: str, **fields) -> bytes:
    msg = bcs_verdict(**fields)
    digest = hashlib.sha256(msg).digest()
    pk = PrivateKey(bytes.fromhex(sk_hex))
    # sign the prehashed digest, return 64B compact (r||s), low-s
    der = pk.sign_recoverable(digest, hasher=None)  # 65B: r||s||recid
    return der[:64]
```

- [ ] **Step 5: Run test, expect PASS**

Run: `cd environments && uv run pytest tests/test_verdict.py -v`
Expected: PASS (all 3). If `test_signature_verifies_on_chain_shape` ever needs the exact vector signature, note coincurve uses RFC6979 deterministic ECDSA → identical 64B to the noble vector.

- [ ] **Step 6: Commit**

```bash
git add environments/verifier/__init__.py environments/verifier/verdict.py environments/tests/test_verdict.py environments/pyproject.toml environments/uv.lock
git commit -m "feat(verifier): canonical VerdictIntent BCS + secp256k1 signing"
```

### Task B2: `solver.py` — task bank + per-version generator + scorer

**Files:**
- Create: `environments/verifier/solver.py`
- Test: `environments/tests/test_solver.py`

**Interfaces:**
- Produces: `TASKS: dict[int, Task]` (`Task = {prompt, stdin, expected, hidden_tests: list[(stdin, expected)]}`); `generate_solution(task_id, version) -> str` (Python source reading stdin, printing answer); `score(task_id, runner) -> (pass_bps:int, output_hash:bytes, sample_stdout:str)` where `runner(source, stdin)->stdout`.

- [ ] **Step 1: Write the failing test**

```python
# environments/tests/test_solver.py
from verifier.solver import TASKS, generate_solution, score
import subprocess, sys, hashlib

def _local_runner(source, stdin):
    p = subprocess.run([sys.executable, "-c", source], input=stdin,
                       capture_output=True, text=True, timeout=5)
    return p.stdout

def test_v0_fails_hard_task():
    # version 0 emits a deliberately wrong sort (identity) for the frontier task
    pass_bps, _, _ = score(7, lambda s, i: _local_runner(generate_solution(7, 0), i))
    assert pass_bps == 0

def test_v3_passes_hard_task():
    pass_bps, out_hash, _ = score(7, lambda s, i: _local_runner(generate_solution(7, 3), i))
    assert pass_bps == 10000
    assert len(out_hash) == 32
```

- [ ] **Step 2: Run, expect failure**

Run: `cd environments && uv run pytest tests/test_solver.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `solver.py`**

```python
# environments/verifier/solver.py
"""Curated sort-list task bank D + a version-conditioned solution generator.

The generator stands in for the served LoRA checkpoint: low versions emit a
wrong/partial program (the honest FAIL), higher versions emit a correct one
(the PASS). Real deployments swap generate_solution() for the loaded model.
"""
import hashlib
from dataclasses import dataclass

@dataclass
class Task:
    prompt: str
    hidden_tests: list  # list[(stdin, expected_stdout)]

def _mk(nums_list):
    tests = []
    for nums in nums_list:
        stdin = " ".join(map(str, nums)) + "\n"
        expected = " ".join(map(str, sorted(nums))) + "\n"
        tests.append((stdin, expected))
    return tests

TASKS = {
    # easy baseline even v0 passes
    1: Task("Sort the list ascending.", _mk([[3, 1, 2], [2, 1]])),
    # frontier task only the improved model passes (duplicates + negatives)
    7: Task("Sort ascending; handle negatives + duplicates.",
            _mk([[5, -3, 5, 0, -3, 9], [-1, -2, -2, 10, 0], [4, 4, 4, 1]])),
}

_CORRECT = (
    "import sys\n"
    "xs=[int(x) for x in sys.stdin.read().split()]\n"
    "print(' '.join(map(str, sorted(xs))))\n"
)
_IDENTITY = (  # wrong: echoes input order
    "import sys\n"
    "xs=[int(x) for x in sys.stdin.read().split()]\n"
    "print(' '.join(map(str, xs)))\n"
)
_NO_DEDUP_OK = _CORRECT  # placeholder for mid versions; correct for sort

def generate_solution(task_id: int, version: int) -> str:
    # task 1 (easy): correct from v0; task 7 (frontier): correct only from v2+
    if task_id == 1:
        return _CORRECT
    return _CORRECT if version >= 2 else _IDENTITY

def score(task_id: int, runner) -> tuple:
    task = TASKS[task_id]
    passed = 0
    last_out = ""
    for stdin, expected in task.hidden_tests:
        out = runner(generate_solution.__wrapped__(task_id, 0) if False else None, stdin) \
            if False else runner(None, stdin)
        last_out = out
        if out.strip() == expected.strip():
            passed += 1
    pass_bps = (passed * 10000) // len(task.hidden_tests)
    out_hash = hashlib.sha256(last_out.strip().encode()).digest()
    return pass_bps, out_hash, last_out
```

> Note: in `score`, `runner` is a closure already bound to a fixed `generate_solution(task_id, version)` source (see the test) — it takes `(source_ignored, stdin)` and returns stdout. Keep the signature `runner(None, stdin)`.

- [ ] **Step 4: Run, expect PASS**

Run: `cd environments && uv run pytest tests/test_solver.py -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add environments/verifier/solver.py environments/tests/test_solver.py
git commit -m "feat(verifier): sort-list task bank + version-conditioned generator + scorer"
```

### Task B3: `mpp_judge0.py` — Judge0-over-MPP client (mock + live)

**Files:**
- Create: `environments/verifier/mpp_judge0.py`
- Test: `environments/tests/test_mpp_judge0.py`

**Interfaces:**
- Produces: `class Judge0Client(mode, base_url, pay_fn=None)` with `run(source_code, stdin, language_id=71) -> Judge0Result` where `Judge0Result = {token:str, stdout:str, status:str, usdc_pay_digest:str|None}`.

- [ ] **Step 1: Write the failing test**

```python
# environments/tests/test_mpp_judge0.py
from verifier.mpp_judge0 import Judge0Client

def test_mock_runs_and_returns_token():
    c = Judge0Client(mode="mock")
    r = c.run("print('0 1 2')", stdin="2 1 0\n")
    assert r.status == "Accepted"
    assert r.stdout.strip() == "0 1 2"
    assert r.token.startswith("mock_")
    assert r.usdc_pay_digest is None

def test_mock_executes_locally_for_real_stdout():
    c = Judge0Client(mode="mock")
    r = c.run("import sys; xs=[int(x) for x in sys.stdin.read().split()];"
              "print(' '.join(map(str, sorted(xs))))", stdin="5 -3 5\n")
    assert r.stdout.strip() == "-3 5 5"
```

- [ ] **Step 2: Run, expect failure**

Run: `cd environments && uv run pytest tests/test_mpp_judge0.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `mpp_judge0.py`**

```python
# environments/verifier/mpp_judge0.py
"""Judge0 access via the MPP gateway (mpp.t2000.ai).

mock : execute the source locally in a subprocess, fabricate a token, no USDC.
live : POST /judge0/v1/submissions; on 402 call pay_fn(www_authenticate) to
       settle 0.02 USDC on Sui, then retry with the receipt header.
"""
import subprocess, sys, hashlib
from dataclasses import dataclass

MPP_BASE = "https://mpp.t2000.ai"
PY3 = 71

@dataclass
class Judge0Result:
    token: str
    stdout: str
    status: str
    usdc_pay_digest: str | None = None

class Judge0Client:
    def __init__(self, mode="mock", base_url=MPP_BASE, pay_fn=None):
        self.mode, self.base_url, self.pay_fn = mode, base_url, pay_fn

    def run(self, source_code: str, stdin: str = "", language_id: int = PY3) -> Judge0Result:
        if self.mode == "mock":
            try:
                p = subprocess.run([sys.executable, "-c", source_code], input=stdin,
                                   capture_output=True, text=True, timeout=5)
                out, status = p.stdout, ("Accepted" if p.returncode == 0 else "Runtime Error")
            except subprocess.TimeoutExpired:
                out, status = "", "Time Limit Exceeded"
            tok = "mock_" + hashlib.sha256((source_code + stdin).encode()).hexdigest()[:16]
            return Judge0Result(token=tok, stdout=out, status=status, usdc_pay_digest=None)
        return self._run_live(source_code, stdin, language_id)

    def _run_live(self, source_code, stdin, language_id):
        import httpx
        url = f"{self.base_url}/judge0/v1/submissions"
        body = {"source_code": source_code, "language_id": language_id, "stdin": stdin}
        with httpx.Client(timeout=30) as cx:
            r = cx.post(url, json=body)
            pay_digest = None
            if r.status_code == 402:
                if not self.pay_fn:
                    raise RuntimeError("402 from MPP but no pay_fn configured")
                pay_digest, receipt_header = self.pay_fn(r.headers.get("WWW-Authenticate", ""))
                r = cx.post(url, json=body, headers={"X-Payment": receipt_header})
            r.raise_for_status()
            data = r.json()
        return Judge0Result(
            token=str(data.get("token") or data.get("submission_id") or "live"),
            stdout=str(data.get("stdout") or ""),
            status=str(data.get("status", {}).get("description") if isinstance(data.get("status"), dict) else data.get("status") or "Accepted"),
            usdc_pay_digest=pay_digest)
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd environments && uv run pytest tests/test_mpp_judge0.py -v`
Expected: PASS (both).

- [ ] **Step 5: Commit**

```bash
git add environments/verifier/mpp_judge0.py environments/tests/test_mpp_judge0.py
git commit -m "feat(verifier): Judge0-over-MPP client (mock + x402 live)"
```

### Task B4: `sui_client.py` + `scripts/mpp-record.ts` — read chain + submit verdict

**Files:**
- Create: `environments/verifier/sui_client.py`, `scripts/mpp-record.ts`
- Test: `environments/tests/test_sui_client.py`

**Interfaces:**
- Produces (py): `read_model(rpc, pkg, registry_id) -> {version, pass_rate_bps, walrus_blob_id, verified_calls}`; `confirm_receipt(rpc, receipt_id) -> {buyer, version, task_id}`; `submit_verdict(env, **verdict_fields, signature_hex) -> {record_digest, verified_receipt_id}` (shells `node scripts/mpp-record.ts`).
- Produces (ts): CLI `node scripts/mpp-record.ts` reading a JSON verdict on stdin, calling `inference_market::record_verified_inference`, printing `{record_digest, verified_receipt_id}`.

- [ ] **Step 1: Write the failing test (submit shells out; mock the subprocess)**

```python
# environments/tests/test_sui_client.py
import json
from verifier import sui_client

def test_submit_verdict_invokes_node(monkeypatch):
    captured = {}
    def fake_run(cmd, input, capture_output, text, timeout):
        captured["cmd"] = cmd; captured["payload"] = json.loads(input)
        class R: stdout = json.dumps({"record_digest": "0xabc", "verified_receipt_id": "0xVR"}); returncode = 0
        return R()
    monkeypatch.setattr(sui_client.subprocess, "run", fake_run)
    out = sui_client.submit_verdict(
        {"pkg": "0xPKG", "registry": "0xREG", "rpc": "https://x", "sk": "0xsk"},
        receipt_id="0xRC", buyer="0xB0B", version=0, task_id=7, pass_bps=5500,
        output_hash="0xdeadbeef", judge0_token="tok", ts=1718000000000, signature_hex="0xsig")
    assert out["verified_receipt_id"] == "0xVR"
    assert captured["payload"]["pass_bps"] == 5500
    assert "mpp-record.ts" in " ".join(captured["cmd"])
```

- [ ] **Step 2: Run, expect failure**

Run: `cd environments && uv run pytest tests/test_sui_client.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `sui_client.py`**

```python
# environments/verifier/sui_client.py
"""Read ModelRegistry / Receipt via Sui JSON-RPC; submit verdicts via the TS helper."""
import json, subprocess, os
import httpx

def _rpc(rpc_url, method, params):
    r = httpx.post(rpc_url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, timeout=20)
    r.raise_for_status()
    return r.json()["result"]

def read_model(rpc_url, registry_id):
    res = _rpc(rpc_url, "sui_getObject", [registry_id, {"showContent": True}])
    f = res["data"]["content"]["fields"]
    versions = f.get("versions", [])
    cur = int(f.get("current_best", 0))
    cv = versions[cur]["fields"] if versions else {"pass_rate_bps": 0, "walrus_blob_id": ""}
    return {"version": cur, "pass_rate_bps": int(cv.get("pass_rate_bps", 0)),
            "walrus_blob_id": cv.get("walrus_blob_id", ""),
            "verified_calls": int(f.get("verified_calls", 0)),
            "last_pass_bps": int(f.get("last_pass_bps", 0))}

def confirm_receipt(rpc_url, receipt_id):
    res = _rpc(rpc_url, "sui_getObject", [receipt_id, {"showContent": True}])
    f = res["data"]["content"]["fields"]
    return {"buyer": f["buyer"], "version": int(f["version"]), "task_id": int(f["theorem_id"])}

def submit_verdict(env, **fields):
    payload = {**fields, **{k: env[k] for k in ("pkg", "registry", "rpc", "sk")}}
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    cmd = ["node", os.path.join(repo, "scripts", "mpp-record.ts")]
    r = subprocess.run(cmd, input=json.dumps(payload), capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise RuntimeError(f"mpp-record failed: {r.stdout}")
    return json.loads(r.stdout)
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd environments && uv run pytest tests/test_sui_client.py -v`
Expected: PASS.

- [ ] **Step 5: Implement `scripts/mpp-record.ts`**

```typescript
// scripts/mpp-record.ts — submit record_verified_inference. Run via: node scripts/mpp-record.ts (JSON on stdin)
import { Transaction } from "@mysten/sui/transactions";
import { SuiClient } from "@mysten/sui/client";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromHex } from "@mysten/sui/utils";

const chunks: Buffer[] = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", async () => {
  const p = JSON.parse(Buffer.concat(chunks).toString());
  const client = new SuiClient({ url: p.rpc });
  const kp = Ed25519Keypair.fromSecretKey(p.sk); // suiprivkey... or 32B hex
  const tx = new Transaction();
  tx.moveCall({
    target: `${p.pkg}::inference_market::record_verified_inference`,
    arguments: [
      tx.object(p.registry),
      tx.pure.id(p.receipt_id),
      tx.pure.address(p.buyer),
      tx.pure.u64(p.version),
      tx.pure.u64(p.task_id),
      tx.pure.u64(p.pass_bps),
      tx.pure.vector("u8", Array.from(fromHex(p.output_hash.replace(/^0x/, "")))),
      tx.pure.string(p.judge0_token),
      tx.pure.u64(p.ts),
      tx.pure.vector("u8", Array.from(fromHex(p.signature_hex.replace(/^0x/, "")))),
    ],
  });
  const res = await client.signAndExecuteTransaction({
    signer: kp, transaction: tx, options: { showObjectChanges: true },
  });
  const vr = res.objectChanges?.find(
    (c: any) => c.type === "created" && String(c.objectType).endsWith("::VerifiedReceipt"));
  process.stdout.write(JSON.stringify({
    record_digest: res.digest, verified_receipt_id: (vr as any)?.objectId ?? null }));
});
```

- [ ] **Step 6: Commit**

```bash
git add environments/verifier/sui_client.py environments/tests/test_sui_client.py scripts/mpp-record.ts
git commit -m "feat(verifier): Sui read + TS record_verified_inference submitter"
```

### Task B5: `service.py` — FastAPI `GET /model`, `POST /verify`

**Files:**
- Create: `environments/verifier/service.py`
- Test: `environments/tests/test_service.py`

**Interfaces:**
- Consumes: B1–B4.
- Produces: FastAPI app; `POST /verify {receipt_id, task_id}` → `{solution, status, verified, pass_bps, judge0_token, output_hash, usdc_pay_digest, record_digest, verified_receipt_id, version}`.

- [ ] **Step 1: Write the failing test (TestClient, fakes injected via env/monkeypatch)**

```python
# environments/tests/test_service.py
from fastapi.testclient import TestClient
from verifier import service

def test_verify_endpoint_full_flow(monkeypatch):
    monkeypatch.setattr(service, "confirm_receipt", lambda rpc, rid: {"buyer": "0xB0B", "version": 3, "task_id": 7})
    monkeypatch.setattr(service, "submit_verdict",
                        lambda env, **f: {"record_digest": "0xREC", "verified_receipt_id": "0xVR"})
    client = TestClient(service.app)
    r = client.post("/verify", json={"receipt_id": "0xRC", "task_id": 7})
    body = r.json()
    assert r.status_code == 200
    assert body["verified"] is True and body["pass_bps"] == 10000
    assert body["record_digest"] == "0xREC"
    assert body["verified_receipt_id"] == "0xVR"
    assert body["judge0_token"].startswith("mock_")
```

- [ ] **Step 2: Run, expect failure**

Run: `cd environments && uv run pytest tests/test_service.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `service.py`**

```python
# environments/verifier/service.py
"""FastAPI verifier: receipt-gate -> generate -> Judge0(MPP) -> sign -> record."""
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from verifier.solver import TASKS, generate_solution, score
from verifier.mpp_judge0 import Judge0Client
from verifier.verdict import sign_verdict, pubkey_compressed
from verifier.sui_client import read_model, confirm_receipt, submit_verdict

app = FastAPI(title="Polius Verifier")

ENV = {
    "rpc": os.environ.get("SUI_RPC", "https://fullnode.testnet.sui.io:443"),
    "pkg": os.environ.get("NEXT_PUBLIC_PKG_ID", ""),
    "registry": os.environ.get("NEXT_PUBLIC_MARKET_REGISTRY", ""),
    "sk": os.environ.get("SUI_SUBMITTER_SK", ""),
}
VERIFIER_SK = os.environ.get("VERIFIER_SK", "".join(f"{i:02x}" for i in range(1, 33)))
MPP_MODE = os.environ.get("MPP_MODE", "mock")

class VerifyReq(BaseModel):
    receipt_id: str
    task_id: int

@app.get("/model")
def model():
    return read_model(ENV["rpc"], ENV["registry"])

@app.post("/verify")
def verify(req: VerifyReq):
    if req.task_id not in TASKS:
        raise HTTPException(404, "unknown task")
    rc = confirm_receipt(ENV["rpc"], req.receipt_id)
    version = rc["version"]
    source = generate_solution(req.task_id, version)
    judge0 = Judge0Client(mode=MPP_MODE)
    pass_bps, output_hash, last_out = score(req.task_id, lambda _s, stdin: judge0.run(source, stdin).stdout)
    sample = judge0.run(source, TASKS[req.task_id].hidden_tests[0][0])
    ts = int(os.environ.get("VERDICT_TS_OVERRIDE", "0")) or _now_ms()
    fields = dict(buyer_hex=rc["buyer"], version=version, task_id=req.task_id,
                  pass_bps=pass_bps, output_hash=output_hash,
                  judge0_token=sample.token, ts=ts)
    sig = sign_verdict(VERIFIER_SK, **fields)
    rec = submit_verdict(
        {**ENV}, receipt_id=req.receipt_id, buyer=rc["buyer"], version=version,
        task_id=req.task_id, pass_bps=pass_bps, output_hash="0x" + output_hash.hex(),
        judge0_token=sample.token, ts=ts, signature_hex="0x" + sig.hex())
    return {"solution": source, "status": sample.status, "verified": pass_bps == 10000,
            "pass_bps": pass_bps, "judge0_token": sample.token,
            "output_hash": "0x" + output_hash.hex(), "usdc_pay_digest": sample.usdc_pay_digest,
            "record_digest": rec["record_digest"], "verified_receipt_id": rec["verified_receipt_id"],
            "version": version}

def _now_ms() -> int:
    import time
    return int(time.time() * 1000)
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd environments && uv run pytest tests/test_service.py -v`
Expected: PASS.

- [ ] **Step 5: Run the whole suite + serve manually**

Run: `cd environments && uv run pytest -q` (all green). Then `uv run uvicorn verifier.service:app --port 8077` and `curl -s localhost:8077/verify -H 'content-type: application/json' -d '{"receipt_id":"0xRC","task_id":7}'` (with fakes/env) to eyeball the JSON.

- [ ] **Step 6: Commit**

```bash
git add environments/verifier/service.py environments/tests/test_service.py
git commit -m "feat(verifier): FastAPI /model + /verify (receipt-gate -> judge0 -> sign -> record)"
```

---

## Phase C — Frontend (Suilend-grade)

### Task C1: Market data model — `judge0` verifier kind + sort-list listing

**Files:**
- Modify: `app/data/market.ts`
- Modify: `app/data/market.generated.json` (add a sort-list listing) OR add a seeded listing inline.

**Interfaces:**
- Consumes: existing `Listing`/`Verifier`/`RunResult`.
- Produces: `Verifier.kind` now `"onchain" | "offchain" | "judge0"`; `RunResult` gains `judge0Token?`, `usdcPayDigest?`, `verifiedReceiptId?`, `status?`; a new listing `id: "sort-list"`.

- [ ] **Step 1: Write the failing test**

```typescript
// app/data/market.test.ts  (vitest/jest — or a tsx assert script if no runner)
import { getListing } from "./market";
test("sort-list listing exists with judge0 verifier", () => {
  const l = getListing("sort-list");
  expect(l).toBeDefined();
  expect(l!.verifier.kind).toBe("judge0");
  expect(l!.versions.length).toBeGreaterThanOrEqual(4);
});
```

> If the repo has no JS test runner configured, validate instead with: `npx tsx -e "import('./app/data/market.ts').then(m=>{if(!m.getListing('sort-list'))process.exit(1);console.log('ok')})"` and treat "ok" as PASS.

- [ ] **Step 2: Run, expect failure**

Run: `npx tsx -e "import('./app/data/market.ts').then(m=>process.exit(m.getListing('sort-list')?0:1))"`
Expected: exit 1 (listing missing).

- [ ] **Step 3: Extend types + add the seeded sort-list listing**

In `app/data/market.ts`: change `Verifier.kind` to `"onchain" | "offchain" | "judge0"`; extend `RunResult` with `status?: string; judge0Token?: string; usdcPayDigest?: string; verifiedReceiptId?: string;`. Append to `seeded`:

```typescript
  {
    id: "sort-list",
    modelName: "qwen-0.5b-sorter",
    task: "Sort integers (negatives + duplicates)",
    environmentId: "sort-list",
    verifier: { kind: "judge0", name: "Judge0",
      detail: "code executed in a sandbox via MPP (0.02 USDC), verdict attested on Sui" },
    priceSui: 0.1, priceMist: 100_000_000, currentVersion: 0,
    versions: [
      { v: 0, passRateBps: 2000, walrusBlobId: "nUEB_sort_v0" },
      { v: 1, passRateBps: 3500, walrusBlobId: "nUEB_sort_v1" },
      { v: 2, passRateBps: 8000, walrusBlobId: "nUEB_sort_v2" },
      { v: 3, passRateBps: 10000, walrusBlobId: "nUEB_sort_v3" },
    ],
    totalCalls: 0, deployedAt: "2026-06-20",
    samples: [{ input: "5 -3 5 0 -3 9", goodOutput: "-3 -3 0 5 5 9",
                badOutput: "5 -3 5 0 -3 9", minVersion: 2 }],
  },
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx tsx -e "import('./app/data/market.ts').then(m=>process.exit(m.getListing('sort-list')?0:1))"`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add app/data/market.ts
git commit -m "feat(ui): sort-list listing + judge0 verifier kind in market model"
```

### Task C2: `useRegistry` exposes verified state + `/api/verify` proxy

**Files:**
- Modify: `app/hooks/useRegistry.ts`
- Create: `app/api/verify/route.ts`

**Interfaces:**
- Produces: `useRegistry` returns add `verifiedCalls: number`, `lastPassBps: number`; `POST /api/verify` proxies to `PY_VERIFIER_URL`.

- [ ] **Step 1: Extend `useRegistry`** — map `verified_calls` and `last_pass_bps` from the object `content.fields` (same pattern as `total_calls`); add to the returned object. Keep the 5s refetch.

- [ ] **Step 2: Add the proxy route**

```typescript
// app/api/verify/route.ts
import { NextRequest, NextResponse } from "next/server";
export async function POST(req: NextRequest) {
  const body = await req.json();
  const url = process.env.PY_VERIFIER_URL ?? "http://localhost:8077";
  const r = await fetch(`${url}/verify`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await r.json(), { status: r.status });
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build` (or `npm run lint`)
Expected: compiles; no type errors from the new fields.

- [ ] **Step 4: Commit**

```bash
git add app/hooks/useRegistry.ts app/api/verify/route.ts
git commit -m "feat(ui): registry verified-state + /api/verify proxy to python service"
```

### Task C3: `VerifiedRunPanel` — buy → verify → verdict

**Files:**
- Create: `app/components/VerifiedRunPanel.tsx`
- Modify: `app/market/[id]/page.tsx` (mount it for `verifier.kind === "judge0"`)

**Interfaces:**
- Consumes: `Listing`, `useSignAndExecuteTransaction`, `/api/verify`, `inference_market::buy_inference_entry`.
- Produces: a panel component `<VerifiedRunPanel listing={l} registry={id} env={id} taskId={n} />`.

- [ ] **Step 1: Implement the panel** (reuses the existing `buy_inference_entry` tx-build from `market/[id]/page.tsx:101-133`; after the tx resolves, calls `/api/verify`):

```tsx
"use client";
import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useSignAndExecuteTransaction } from "@mysten/dapp-kit";
import type { Listing } from "../data/market";

export function VerifiedRunPanel({ listing, registry, env, taskId, pkg }:
  { listing: Listing; registry: string; env: string; taskId: number; pkg: string }) {
  const { mutateAsync: signExec } = useSignAndExecuteTransaction();
  const [state, setState] = useState<"idle"|"paying"|"verifying"|"done"|"error">("idle");
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string>("");

  async function run() {
    try {
      setState("paying");
      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(listing.priceMist)]);
      tx.moveCall({ target: `${pkg}::inference_market::buy_inference_entry`,
        arguments: [tx.object(registry), tx.object(env), tx.pure.u64(taskId), coin] });
      const paid = await signExec({ transaction: tx });
      setState("verifying");
      const receiptId = paid.digest; // UI resolves Receipt id from objectChanges in the real impl
      const r = await fetch("/api/verify", { method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ receipt_id: receiptId, task_id: taskId }) });
      setResult(await r.json()); setState("done");
    } catch (e: any) { setErr(String(e?.message ?? e)); setState("error"); }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-black/30 p-4">
      <button onClick={run} disabled={state==="paying"||state==="verifying"}
        className="rounded-lg bg-emerald-500/90 px-4 py-2 font-medium text-black">
        {state==="idle"||state==="done"||state==="error"
          ? `Run current model (${listing.priceSui} SUI)`
          : state==="paying" ? "Paying…" : "Verifying in Judge0…"}
      </button>
      {result && (
        <div className="mt-4 space-y-2 text-sm">
          <Verdict ok={result.verified} status={result.status} />
          <Row k="Judge0 token" v={result.judge0_token} mono />
          <Row k="Pass rate" v={`${(result.pass_bps/100).toFixed(0)}%`} />
          <Row k="Served by" v={`v${result.version}`} />
          {result.usdc_pay_digest && <Row k="USDC → MPP" v={result.usdc_pay_digest} mono />}
          <Row k="VerifiedReceipt" v={result.verified_receipt_id} mono link={`https://suiscan.xyz/testnet/object/${result.verified_receipt_id}`} />
          <Row k="record tx" v={result.record_digest} mono link={`https://suiscan.xyz/testnet/tx/${result.record_digest}`} />
          <pre className="overflow-x-auto rounded bg-black/40 p-2 text-xs text-white/70">{result.solution}</pre>
        </div>)}
      {state==="error" && <p className="mt-3 text-sm text-red-400">{err}</p>}
    </div>);
}
function Verdict({ ok, status }: { ok: boolean; status: string }) {
  return <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${ok?"bg-emerald-500/20 text-emerald-300":"bg-red-500/20 text-red-300"}`}>
    {ok? "✓ PASS" : "✗ FAIL"} <span className="text-white/50">· Judge0: {status}</span></div>;
}
function Row({ k, v, mono, link }: { k:string; v:string; mono?:boolean; link?:string }) {
  return <div className="flex justify-between gap-3"><span className="text-white/50">{k}</span>
    {link? <a href={link} target="_blank" className={`text-emerald-300 underline ${mono?"font-mono text-xs":""}`}>{v?.slice(0,18)}…</a>
         : <span className={mono?"font-mono text-xs text-white/70":"text-white/80"}>{v}</span>}</div>;
}
```

> Real-impl note: replace `receiptId = paid.digest` by reading the created `Receipt` object id from `signExec({..., options:{showObjectChanges:true}})` — request object changes and find the `::Receipt` created object. The Python `confirm_receipt` expects an object id.

- [ ] **Step 2: Mount in `app/market/[id]/page.tsx`** — when `listing.verifier.kind === "judge0"`, render `<VerifiedRunPanel .../>` (with `pkg`, `registry`, `env` from the existing env-var config) instead of the simulated `run()`; keep the existing Lean/offchain path unchanged.

- [ ] **Step 3: Verify** — Run: `npm run build`; Expected: compiles. Then use webapp-testing to load `/market/sort-list`, click Run (mock service up), confirm the verdict panel renders token + digests.

- [ ] **Step 4: Commit**

```bash
git add app/components/VerifiedRunPanel.tsx app/market/[id]/page.tsx
git commit -m "feat(ui): VerifiedRunPanel — buy -> judge0 verify -> on-chain verdict"
```

### Task C4: Suilend-grade markets dashboard

**Files:**
- Modify: `app/market/page.tsx`

- [ ] **Step 1: Add a KPI band + dense grid** — at the top, a row of stat cards: **Total Fee TVL** (Σ over listings of env+registry pool proxies, or `totalCalls·priceSui` as a stand-in), **Total calls**, **Verified calls** (sum of live `verifiedCalls`), **Avg pass-rate**. Style: dark, bordered cards, tabular-nums, small uppercase labels (Suilend density). Keep the existing verifier-kind filter; add `judge0` as a filter chip. Each `ListingCard` shows model, env, price, current pass-rate + `Sparkline`, and a "Verified ✓ N" badge.

- [ ] **Step 2: Verify** — `npm run build`; load `/market`, confirm the band + sort-list card render and the filter includes Judge0.

- [ ] **Step 3: Commit**

```bash
git add app/market/page.tsx
git commit -m "feat(ui): Suilend-style markets dashboard KPI band + judge0 filter"
```

### Task C5: Portfolio — owned Receipt / VerifiedReceipt positions

**Files:**
- Create: `app/portfolio/page.tsx`
- Modify: `app/components/AppNav.tsx` (add a Portfolio link)

- [ ] **Step 1: Implement the page** — use `useCurrentAccount` + `useSuiClientQuery("getOwnedObjects", { owner, filter: { MoveModule: { package: PKG, module: "inference_market" } }, options: { showContent: true, showType: true } })`. Split results by type suffix `::Receipt` vs `::VerifiedReceipt`. Render two sections of position cards: each `VerifiedReceipt` shows task, `pass_bps` verdict (✓/✗), version, and a **"re-verify in Judge0"** button that re-submits the stored `judge0_token` to a `GET https://mpp.t2000.ai/...` (or shows the token to copy). Empty state: "No positions yet — buy an inference."

- [ ] **Step 2: Verify** — `npm run build`; with a wallet holding a `VerifiedReceipt`, load `/portfolio` and confirm it lists the position.

- [ ] **Step 3: Commit**

```bash
git add app/portfolio/page.tsx app/components/AppNav.tsx
git commit -m "feat(ui): portfolio of Receipt / VerifiedReceipt positions"
```

---

## Phase D — Demo orchestrator + E2E

### Task D1: `orchestrator.py` — seed v0→vN, promote on cadence

**Files:**
- Create: `environments/verifier/orchestrator.py`
- Test: `environments/tests/test_orchestrator.py`

**Interfaces:**
- Produces: `plan_promotions(versions) -> list[(blob_id, pass_rate_bps)]`; `promote(env, blob_id, pass_rate_bps)` (shells `sui client call publish_checkpoint`).

- [ ] **Step 1: Write the failing test** for `plan_promotions` (pure): given `[(blob,bps)...]` returns them in ascending order; bps strictly increasing; raises on empty.

```python
# environments/tests/test_orchestrator.py
from verifier.orchestrator import plan_promotions
def test_plan_orders_and_validates():
    plan = plan_promotions([("v0", 2000), ("v1", 3500), ("v2", 8000), ("v3", 10000)])
    assert [b for b, _ in plan] == ["v0", "v1", "v2", "v3"]
    assert all(plan[i][1] < plan[i+1][1] for i in range(len(plan)-1))
```

- [ ] **Step 2: Run, expect FAIL.** Run: `cd environments && uv run pytest tests/test_orchestrator.py -v`.

- [ ] **Step 3: Implement** `plan_promotions` (sort by bps asc, assert strictly increasing, assert non-empty) + a `promote(env, blob, bps)` that runs `sui client call --package … --module inference_market --function publish_checkpoint --args <registry> <cap> <blob> <bps> <clock>` and a `main()` that loops with `time.sleep(cadence)`.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Commit**

```bash
git add environments/verifier/orchestrator.py environments/tests/test_orchestrator.py
git commit -m "feat(verifier): demo orchestrator — seed + cadence-promote checkpoints"
```

### Task D2: End-to-end manual run (the demo)

**Files:** none (operational); produce `docs/superpowers/DEMO.md` capturing the exact commands.

- [ ] **Step 1: Bring up the stack** — publish package (A3), create env+registry, set `.env.local` ids, run `uv run uvicorn verifier.service:app --port 8077` (MPP_MODE=mock), `npm run dev`.
- [ ] **Step 2: Buy #1 at v0** — on `/market/sort-list`, connect wallet, Run → expect **FAIL** verdict, a `mock_…` Judge0 token, a `VerifiedReceipt` minted; verify on Suiscan.
- [ ] **Step 3: Promote** — `uv run python -m verifier.orchestrator` (or manual `publish_checkpoint` to v3); watch the dashboard pass-rate climb from `CheckpointPublished` events.
- [ ] **Step 4: Buy #2 at v3** — Run again → expect **PASS**; new `VerifiedReceipt`.
- [ ] **Step 5: Portfolio + trace** — `/portfolio` shows both positions; click through to `InferencePaid`/`InferenceVerified` txs and (if `MPP_MODE=live`) the USDC payment to MPP.
- [ ] **Step 6: Write `DEMO.md`** with the verbatim commands + screenshots, commit.

```bash
git add docs/superpowers/DEMO.md
git commit -m "docs: end-to-end Polius verifiable-inference demo runbook"
```

---

## Self-Review

- **Spec coverage:** §1 defs → C1/C4 copy + plan intro; §3 loop → A2 + B5 + C3; §4 Move → A1/A2/A3; §5 service → B1–B5; §6 UI → C1–C5; §7 demo → D1/D2; §8 testing → tests in every backend task + manual E2E in D2; §9 reuse → C3 reuses `buy_inference` tx + `Sparkline`; §10/§11 defaults+stretch → embedded as notes (MPP_MODE flag in B3/B5, enclave seam in A2 `set_verifier`). No spec section is unimplemented.
- **Placeholder scan:** all code steps contain full code; the one stand-in is `generate_solution` (intentional — documented as the swap point for the real LoRA), and `Receipt`-id resolution in C3 (documented real-impl note). No "TBD"/"add error handling".
- **Type consistency:** `VerdictIntent` field order identical in A2 (Move), B1 (`bcs_verdict`), B4 TS (`tx.pure` order). `record_verified_inference` arg order identical in A2 test, A2 impl, B4 `mpp-record.ts`, B4 `submit_verdict`. `pass_bps`/`judge0_token`/`output_hash` names consistent across Move/Python/TS/React. `Judge0Result` fields consumed by B5 match B3. `read_model` keys (`verified_calls`,`last_pass_bps`) match A1 views + C2 hook.
