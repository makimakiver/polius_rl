/// Nautilus-attested environment verification.
///
/// A user deploys an RL environment (dataset + verifier code, referenced by the
/// `Environment.artifact_uri`). To prove the environment is real and trainable,
/// an off-chain worker runs ONE epoch on a sample OSS LLM (e.g. Qwen-0.5B): the
/// model attempts the env's tasks, the env's own verifier scores them, and a
/// baseline reward / pass rate is produced. That epoch runs in (or is attested
/// by) an AWS Nitro enclave (Nautilus), which signs the result. This module
/// verifies that enclave signature on-chain and mints an `EpochAttestation`.
///
/// The signed payload uses the SAME `IntentMessage{intent, timestamp_ms, payload}`
/// shape as `pols_core::enclave`, so a real Nitro-enclave-signed message verifies
/// here unchanged. On testnet the enclave's pubkey is seeded directly; in
/// production it comes from `enclave::register_enclave` (a real Nitro attestation).
module pols_core::env_verifier;

use std::string::String;
use sui::ecdsa_k1;
use pols_core::events;

/// The enclave signature did not verify against `attester_pk`.
const E_BAD_ATTESTATION: u64 = 0;

/// The epoch result a Nautilus enclave attests. Field order mirrors the enclave
/// IntentMessage payload so a real Nitro-signed message verifies unchanged.
public struct EpochPayload has copy, drop {
    env: ID,
    model: String,
    n_samples: u64,
    mean_reward_bps: u64, // baseline mean reward over the epoch, 0..10000
    pass_bps: u64,        // fraction of samples the env's verifier accepted, 0..10000
    dataset_hash: vector<u8>,
}

/// enclave.move-compatible intent wrapper (intent, timestamp_ms, payload).
public struct IntentMessage has copy, drop {
    intent: u8,
    timestamp_ms: u64,
    payload: EpochPayload,
}

/// On-chain proof that an environment passed a TEE-attested verification epoch.
public struct EpochAttestation has key, store {
    id: UID,
    env: ID,
    model: String,
    n_samples: u64,
    mean_reward_bps: u64,
    pass_bps: u64,
    dataset_hash: vector<u8>,
    attester_pk: vector<u8>, // the Nautilus enclave's secp256k1 pubkey
    timestamp_ms: u64,
}

/// Verify a Nautilus(TEE)-attested epoch result for `env` and mint an attestation
/// to the caller. Mirrors `enclave::verify_signature`: reconstruct the signed
/// `IntentMessage`, BCS-encode it, and `secp256k1_verify` (SHA256) against the
/// enclave pubkey.
public fun verify_epoch(
    env: ID,
    attester_pk: vector<u8>,
    intent: u8,
    timestamp_ms: u64,
    model: String,
    n_samples: u64,
    mean_reward_bps: u64,
    pass_bps: u64,
    dataset_hash: vector<u8>,
    signature: vector<u8>,
    ctx: &mut TxContext,
) {
    let payload = EpochPayload {
        env,
        model: clone_string(&model),
        n_samples,
        mean_reward_bps,
        pass_bps,
        dataset_hash: clone_bytes(&dataset_hash),
    };
    let intent_message = IntentMessage { intent, timestamp_ms, payload };
    let bytes = std::bcs::to_bytes(&intent_message);
    assert!(ecdsa_k1::secp256k1_verify(&signature, &attester_pk, &bytes, 1), E_BAD_ATTESTATION);

    events::emit_env_verified(env, clone_string(&model), mean_reward_bps, pass_bps, n_samples);

    let att = EpochAttestation {
        id: object::new(ctx),
        env,
        model,
        n_samples,
        mean_reward_bps,
        pass_bps,
        dataset_hash,
        attester_pk,
        timestamp_ms,
    };
    transfer::public_transfer(att, ctx.sender());
}

/// Entry wrapper for wallets / CLI.
entry fun verify_epoch_entry(
    env: ID,
    attester_pk: vector<u8>,
    intent: u8,
    timestamp_ms: u64,
    model: String,
    n_samples: u64,
    mean_reward_bps: u64,
    pass_bps: u64,
    dataset_hash: vector<u8>,
    signature: vector<u8>,
    ctx: &mut TxContext,
) {
    verify_epoch(
        env, attester_pk, intent, timestamp_ms, model, n_samples,
        mean_reward_bps, pass_bps, dataset_hash, signature, ctx,
    );
}

// ---- views --------------------------------------------------------------

public fun att_env(a: &EpochAttestation): ID { a.env }
public fun att_reward_bps(a: &EpochAttestation): u64 { a.mean_reward_bps }
public fun att_pass_bps(a: &EpochAttestation): u64 { a.pass_bps }
public fun att_n_samples(a: &EpochAttestation): u64 { a.n_samples }

// ---- helpers ------------------------------------------------------------

fun clone_string(s: &String): String { std::string::utf8(*std::string::as_bytes(s)) }
fun clone_bytes(b: &vector<u8>): vector<u8> { *b }
