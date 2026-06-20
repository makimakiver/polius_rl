"""Nautilus (TEE) attestation of an environment-verification epoch.

The epoch result is wrapped in the SAME `IntentMessage{intent, timestamp_ms,
payload}` shape as `pols_core::enclave` / `pols_core::env_verifier`, BCS-encoded,
and signed (secp256k1, SHA256) by the enclave key. On-chain `verify_epoch`
re-derives the same bytes and verifies against the attester pubkey.

In production the signer is an AWS Nitro enclave (Nautilus) whose pubkey is
registered via `enclave::register_enclave` (a real attestation document). For
testnet the enclave key is seeded here (`ENCLAVE_SK`, default the demo key) — the
on-chain signature check is identical either way.
"""
import hashlib
import os

from coincurve import PrivateKey

from verifier.verdict import _u64le, _uleb, _addr32  # shared BCS primitives

# Demo enclave key (sk = 0x01..0x20); pubkey 0x0284bf… matches the seeded attester.
ENCLAVE_SK = os.environ.get("ENCLAVE_SK", "".join(f"{i:02x}" for i in range(1, 33)))
INTENT_SCOPE = 0  # enclave intent scope for epoch attestations


def attester_pk() -> bytes:
    """The Nautilus enclave's compressed secp256k1 pubkey (33 bytes)."""
    return PrivateKey(bytes.fromhex(ENCLAVE_SK)).public_key.format(compressed=True)


def bcs_epoch(*, env_id: str, model: str, n_samples: int, mean_reward_bps: int,
              pass_bps: int, dataset_hash: bytes, timestamp_ms: int,
              intent: int = INTENT_SCOPE) -> bytes:
    """BCS of IntentMessage{intent:u8, timestamp_ms:u64, payload:EpochPayload}.

    EpochPayload = env:ID(32B) · model:String · n_samples:u64 · mean_reward_bps:u64
                   · pass_bps:u64 · dataset_hash:vector<u8>
    """
    m = model.encode()
    payload = (_addr32(env_id) + _uleb(len(m)) + m + _u64le(n_samples)
               + _u64le(mean_reward_bps) + _u64le(pass_bps)
               + _uleb(len(dataset_hash)) + dataset_hash)
    return bytes([intent]) + _u64le(timestamp_ms) + payload


def attest_epoch(*, env_id, model, n_samples, mean_reward_bps, pass_bps,
                 dataset_hash: bytes, timestamp_ms, intent: int = INTENT_SCOPE) -> bytes:
    """Sign the epoch attestation (64-byte secp256k1 over sha256(BCS))."""
    msg = bcs_epoch(env_id=env_id, model=model, n_samples=n_samples,
                    mean_reward_bps=mean_reward_bps, pass_bps=pass_bps,
                    dataset_hash=dataset_hash, timestamp_ms=timestamp_ms, intent=intent)
    digest = hashlib.sha256(msg).digest()
    return PrivateKey(bytes.fromhex(ENCLAVE_SK)).sign_recoverable(digest, hasher=None)[:64]
