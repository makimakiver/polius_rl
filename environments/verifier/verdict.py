"""Canonical VerdictIntent BCS encoding + secp256k1 signing.

Byte layout MUST match pols_core::inference_market::VerdictIntent:
  intent:u8=1, buyer:address(32B BE), version:u64 LE, task_id:u64 LE,
  pass_bps:u64 LE, output_hash:vector<u8>(ULEB+bytes),
  judge0_token:String(ULEB+utf8), ts:u64 LE.
On-chain verify uses hash flag 1 (SHA256), so we sign sha256(msg).
"""
import hashlib
from coincurve import PrivateKey


def _u64le(n: int) -> bytes:
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
