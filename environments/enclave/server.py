#!/usr/bin/env python3
"""Polius env-verification attestation enclave.

Runs inside an AWS Nitro enclave (deployed via Marlin Oyster). Holds a secp256k1
key generated/sealed inside the TEE and signs env-verification epoch results so
that `pols_core::env_verifier::verify_epoch` can check them on-chain.

The BCS encoding here MUST byte-match, or on-chain verification fails:
  - environments/verifier/nautilus.py :: bcs_epoch()
  - contracts/sources/env_verifier.move :: EpochPayload / IntentMessage

Signed message = IntentMessage{ intent:u8, timestamp_ms:u64, payload:EpochPayload },
EpochPayload   = env:ID(32B) · model:String · n_samples:u64 · mean_reward_bps:u64
                 · pass_bps:u64 · dataset_hash:vector<u8>
Signature      = secp256k1 over sha256(BCS), 64-byte compact (low-s, RFC6979).

Endpoints:  GET /health   GET /public-key   POST /attest-epoch
"""
import hashlib
import sys
import time
from pathlib import Path

from coincurve import PrivateKey
from flask import Flask, jsonify, request

INTENT_SCOPE = 0  # must match nautilus.INTENT_SCOPE and the on-chain intent byte

app = Flask(__name__)
signing_key: PrivateKey = None  # set in main()


# ---- BCS primitives (identical to verifier/verdict.py + nautilus.py) ----------
def _u64(n: int) -> bytes:
    return int(n).to_bytes(8, "little")


def _uleb(n: int) -> bytes:
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | 0x80 if n else b)
        if not n:
            return bytes(out)


def _addr32(h: str) -> bytes:
    h = h[2:] if h.startswith("0x") else h
    return bytes.fromhex(h.rjust(64, "0"))


def bcs_epoch(env_id: str, model: str, n_samples: int, mean_reward_bps: int,
              pass_bps: int, dataset_hash: bytes, timestamp_ms: int,
              intent: int = INTENT_SCOPE) -> bytes:
    """BCS of IntentMessage{intent, timestamp_ms, EpochPayload}."""
    m = model.encode()
    payload = (_addr32(env_id) + _uleb(len(m)) + m + _u64(n_samples)
               + _u64(mean_reward_bps) + _u64(pass_bps)
               + _uleb(len(dataset_hash)) + dataset_hash)
    return bytes([intent]) + _u64(timestamp_ms) + payload


def now_ms() -> int:
    return int(time.time() * 1000)


def attester_pk_hex() -> str:
    return "0x" + signing_key.public_key.format(compressed=True).hex()


# ---- endpoints ----------------------------------------------------------------
@app.get("/health")
def health():
    return jsonify({"status": "ok"})


@app.get("/public-key")
def public_key():
    # 33-byte compressed secp256k1 pubkey — the on-chain attester key.
    return jsonify({"public_key": signing_key.public_key.format(compressed=True).hex()})


@app.post("/attest-epoch")
def attest_epoch():
    """Sign an RL-environment verification epoch result.

    Body: { env_id, model, n_samples, mean_reward_bps, pass_bps, dataset_hash, timestamp_ms? }
    """
    try:
        b = request.get_json(force=True)
        ts = int(b.get("timestamp_ms") or now_ms())
        dataset_hash = bytes.fromhex(str(b["dataset_hash"]).replace("0x", ""))
        msg = bcs_epoch(str(b["env_id"]), str(b["model"]), int(b["n_samples"]),
                        int(b["mean_reward_bps"]), int(b["pass_bps"]), dataset_hash, ts)
        digest = hashlib.sha256(msg).digest()
        sig = signing_key.sign_recoverable(digest, hasher=None)[:64]  # 64-byte compact
        return jsonify({
            "env": b["env_id"], "model": b["model"], "n_samples": int(b["n_samples"]),
            "mean_reward_bps": int(b["mean_reward_bps"]), "pass_bps": int(b["pass_bps"]),
            "dataset_hash": "0x" + dataset_hash.hex(), "intent": INTENT_SCOPE,
            "timestamp_ms": ts, "attester_pk": attester_pk_hex(), "signature": "0x" + sig.hex(),
        })
    except Exception as e:
        app.logger.error(f"attest-epoch failed: {e}")
        return jsonify({"error": "attest failed", "message": str(e)}), 400


def load_signing_key(path: Path) -> PrivateKey:
    key = path.read_bytes()
    if len(key) != 32:
        raise ValueError(f"expected 32-byte secp256k1 key, got {len(key)} bytes")
    return PrivateKey(key)


def main():
    global signing_key
    key_path = Path(sys.argv[1] if len(sys.argv) > 1 else "/app/ecdsa.sec")
    print(f"loading secp256k1 key from {key_path}", flush=True)
    signing_key = load_signing_key(key_path)
    print(f"attester pubkey: {attester_pk_hex()}", flush=True)
    print("serving on 0.0.0.0:3000", flush=True)
    app.run(host="0.0.0.0", port=3000, debug=False)


if __name__ == "__main__":
    main()
