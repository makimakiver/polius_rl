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


def test_signature_matches_onchain_vector():
    # round-trip proof: single-hash signature must equal the on-chain-verified vector
    sig = sign_verdict(SK_HEX, **FIELDS)
    assert sig.hex() == (
        "8b1fdb4fb2ccefd2a30fa6d979284dccb743d3ac930f437ab177baa72d9435e2"
        "635b57f112aedb4740cf7c97addb70cb4a08705730f64da4461945003c3363bf")
