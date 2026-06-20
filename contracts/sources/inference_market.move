/// pols_core inference market — pay-per-inference over a self-improving model.
///
/// One `ModelRegistry` tracks the checkpoint history of a single served model
/// (each version = a LoRA adapter on Walrus + its verifier-measured pass rate),
/// tied to the `Environment` it was trained on. Buyers pay per inference; the fee
/// is split between the environment's fee pool (creator/SPG) and the model's own
/// pool. The RL publisher advances checkpoints with a `PublisherCap`.
///
/// Conventions mirror `pols_core::environment`: VERSION gate, cap-gated mutation,
/// events carry full snapshots, public signatures frozen on upgrade.
module pols_core::inference_market;

use std::string::String;
use sui::balance::{Self, Balance};
use sui::coin::{Self, Coin};
use sui::clock::{Self, Clock};
use sui::sui::SUI;
use sui::table::{Self, Table};
use sui::ecdsa_k1;
use pols_core::environment::{Self, Environment};
use pols_core::events;

/// Current on-chain logic version.
const VERSION: u64 = 1;

/// Basis points of each inference fee routed to the environment fee pool (30%).
const ENV_FEE_BPS: u64 = 3000;

/// Caller is interacting through a stale logic version; run `migrate` first.
const E_WRONG_VERSION: u64 = 0;
/// The provided `PublisherCap` does not authorize this `ModelRegistry`.
const E_WRONG_CAP: u64 = 1;
/// The passed `Environment` is not the one this registry serves.
const E_WRONG_ENV: u64 = 2;
/// No checkpoint has been published yet — nothing to serve.
const E_NO_CHECKPOINT: u64 = 3;
/// The verdict signature did not verify against this registry's verifier key.
const E_BAD_VERDICT_SIG: u64 = 4;
/// A verdict with this timestamp has already been recorded (replay).
const E_VERDICT_REPLAY: u64 = 5;

/// One published checkpoint: a Walrus LoRA adapter + its verifier pass rate.
public struct ModelVersion has store {
    walrus_blob_id: String,
    pass_rate_bps: u64,
    published_at: u64,
}

/// Shared commons: the served model's checkpoint history + fee pool.
public struct ModelRegistry has key {
    id: UID,
    environment: ID, // the Environment this model was trained on
    creator: address,
    current_best: u64, // index into `versions`
    versions: vector<ModelVersion>,
    fee_pool: Balance<SUI>, // the model's own cut of inference fees
    total_calls: u64,
    verifier_pk: vector<u8>,            // secp256k1 (33B compressed) of this registry's verifier
    verified_calls: u64,
    last_pass_bps: u64,
    verified_ts: Table<u64, bool>,      // replay guard on verdict ts
    version: u64,
}

/// Owned authority to publish checkpoints to one registry (held by the RL side).
public struct PublisherCap has key, store {
    id: UID,
    registry: ID,
}

/// Attestation that a paid inference was executed + graded; minted to the buyer
/// after a valid `VerdictIntent` signature is recorded.
public struct VerifiedReceipt has key, store {
    id: UID,
    registry: ID,
    buyer: address,
    version: u64,
    task_id: u64,
    pass_bps: u64,
    judge0_token: String,
    output_hash: vector<u8>,
}

/// Canonical signed verdict — field order/types are the Move⇄Python⇄TS contract.
/// BCS layout: intent:u8, buyer:address(32B), version:u64 LE, task_id:u64 LE,
/// pass_bps:u64 LE, output_hash:vector<u8>(ULEB+bytes),
/// judge0_token:String(ULEB+utf8), ts:u64 LE. Object IDs are NOT signed.
public struct VerdictIntent has copy, drop {
    intent: u8,
    buyer: address,
    version: u64,
    task_id: u64,
    pass_bps: u64,
    output_hash: vector<u8>,
    judge0_token: String,
    ts: u64,
}

/// Proof of a paid inference; the off-chain server honors it before serving.
public struct Receipt has key, store {
    id: UID,
    registry: ID,
    buyer: address,
    version: u64,
    theorem_id: u64,
    paid: u64,
}

// ---- creation -----------------------------------------------------------

/// Create a registry for `environment`, share it, and return its publisher cap.
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

/// Convenience entry: share the registry and send the cap to the sender.
entry fun create_registry_entry(environment: ID, verifier_pk: vector<u8>, ctx: &mut TxContext) {
    let cap = create_registry(environment, verifier_pk, ctx);
    transfer::public_transfer(cap, ctx.sender());
}

// ---- publishing (cap-gated) --------------------------------------------

/// Append a new checkpoint and make it current-best. Cap-gated.
public fun publish_checkpoint(
    registry: &mut ModelRegistry,
    cap: &PublisherCap,
    walrus_blob_id: String,
    pass_rate_bps: u64,
    clock: &Clock,
) {
    assert_version(registry);
    assert!(cap.registry == object::id(registry), E_WRONG_CAP);

    let v = vector::length(&registry.versions);
    let blob_copy = clone_string(&walrus_blob_id);
    vector::push_back(
        &mut registry.versions,
        ModelVersion { walrus_blob_id, pass_rate_bps, published_at: clock::timestamp_ms(clock) },
    );
    registry.current_best = v;
    events::emit_checkpoint_published(object::id(registry), v, blob_copy, pass_rate_bps);
}

// ---- buying -------------------------------------------------------------

/// Pay for one inference on the current-best model. Splits the fee between the
/// environment's pool and the model's pool, issues a `Receipt` to the buyer.
public fun buy_inference(
    registry: &mut ModelRegistry,
    env: &mut Environment,
    theorem_id: u64,
    mut payment: Coin<SUI>,
    ctx: &mut TxContext,
): Receipt {
    assert_version(registry);
    assert!(!vector::is_empty(&registry.versions), E_NO_CHECKPOINT);
    assert!(object::id(env) == registry.environment, E_WRONG_ENV);

    let paid = coin::value(&payment);
    let to_env = (paid * ENV_FEE_BPS) / 10000;

    // route the environment's cut, keep the rest in the model's pool
    let env_coin = coin::split(&mut payment, to_env, ctx);
    environment::deposit_fees(env, env_coin);
    let to_registry = coin::value(&payment);
    balance::join(&mut registry.fee_pool, coin::into_balance(payment));

    registry.total_calls = registry.total_calls + 1;
    let version = registry.current_best;
    let buyer = ctx.sender();
    events::emit_inference_paid(
        object::id(registry), buyer, version, theorem_id, paid, to_env, to_registry,
    );
    Receipt {
        id: object::new(ctx),
        registry: object::id(registry),
        buyer,
        version,
        theorem_id,
        paid,
    }
}

/// Entry wrapper: buy and transfer the receipt to the buyer.
entry fun buy_inference_entry(
    registry: &mut ModelRegistry,
    env: &mut Environment,
    theorem_id: u64,
    payment: Coin<SUI>,
    ctx: &mut TxContext,
) {
    let receipt = buy_inference(registry, env, theorem_id, payment, ctx);
    transfer::public_transfer(receipt, ctx.sender());
}

// ---- verified inference (signed verdicts) -------------------------------

/// Rotate this registry's verifier key. Cap-gated.
public fun set_verifier(registry: &mut ModelRegistry, cap: &PublisherCap, verifier_pk: vector<u8>) {
    assert_version(registry);
    assert!(cap.registry == object::id(registry), E_WRONG_CAP);
    registry.verifier_pk = verifier_pk;
}

/// Record a signed verdict: verify the verifier's secp256k1 signature over the
/// canonical `VerdictIntent` BCS, guard against ts replay, bump counters, emit
/// the event, and mint a `VerifiedReceipt` to the buyer.
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
        intent: 1u8,
        buyer,
        version,
        task_id,
        pass_bps,
        output_hash: clone_bytes(&output_hash),
        judge0_token: clone_string(&judge0_token),
        ts,
    };
    // The verifier signs the ECDSA digest sha256(BCS); flag 1 makes Sui hash
    // the raw BCS with SHA256 and verify against that — a single, idiomatic hash.
    let msg = std::bcs::to_bytes(&intent);
    let ok = ecdsa_k1::secp256k1_verify(&signature, &registry.verifier_pk, &msg, 1);
    assert!(ok, E_BAD_VERDICT_SIG);

    table::add(&mut registry.verified_ts, ts, true);
    registry.verified_calls = registry.verified_calls + 1;
    registry.last_pass_bps = pass_bps;

    events::emit_inference_verified(
        object::id(registry), buyer, version, task_id, pass_bps,
        clone_string(&judge0_token), clone_bytes(&output_hash),
    );

    let vr = VerifiedReceipt {
        id: object::new(ctx),
        registry: object::id(registry),
        buyer,
        version,
        task_id,
        pass_bps,
        judge0_token,
        output_hash,
    };
    let _ = receipt_id; // payment receipt linked via event/UI; not part of signed payload
    transfer::public_transfer(vr, buyer);
}

// ---- views --------------------------------------------------------------

public fun current_best(registry: &ModelRegistry): u64 { registry.current_best }

public fun version_count(registry: &ModelRegistry): u64 {
    vector::length(&registry.versions)
}

public fun pass_rate_of(registry: &ModelRegistry, v: u64): u64 {
    vector::borrow(&registry.versions, v).pass_rate_bps
}

public fun blob_of(registry: &ModelRegistry, v: u64): String {
    clone_string(&vector::borrow(&registry.versions, v).walrus_blob_id)
}

public fun fee_pool_value(registry: &ModelRegistry): u64 {
    balance::value(&registry.fee_pool)
}

public fun total_calls(registry: &ModelRegistry): u64 { registry.total_calls }

public fun verifier_pk(r: &ModelRegistry): vector<u8> { r.verifier_pk }
public fun verified_calls(r: &ModelRegistry): u64 { r.verified_calls }
public fun last_pass_bps(r: &ModelRegistry): u64 { r.last_pass_bps }

public fun receipt_version(r: &Receipt): u64 { r.version }
public fun receipt_paid(r: &Receipt): u64 { r.paid }

public fun vreceipt_pass_bps(v: &VerifiedReceipt): u64 { v.pass_bps }
public fun vreceipt_token(v: &VerifiedReceipt): String { clone_string(&v.judge0_token) }

// ---- upgrade plumbing ---------------------------------------------------

fun assert_version(registry: &ModelRegistry) {
    assert!(registry.version == VERSION, E_WRONG_VERSION);
}

public fun migrate(registry: &mut ModelRegistry, cap: &PublisherCap) {
    assert!(cap.registry == object::id(registry), E_WRONG_CAP);
    assert!(registry.version < VERSION, E_WRONG_VERSION);
    registry.version = VERSION;
}

// ---- helpers ------------------------------------------------------------

/// Clone a `String` (no native copy) by round-tripping its bytes.
fun clone_string(s: &String): String {
    std::string::utf8(*std::string::as_bytes(s))
}

/// Clone a `vector<u8>` (no native copy ability on the borrowed ref).
fun clone_bytes(b: &vector<u8>): vector<u8> { *b }
