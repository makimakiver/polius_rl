import json
from verifier import sui_client


def test_submit_verdict_invokes_node(monkeypatch):
    captured = {}

    def fake_run(cmd, input, capture_output, text, timeout):
        captured["cmd"] = cmd
        captured["payload"] = json.loads(input)

        class R:
            stdout = json.dumps({"record_digest": "0xabc", "verified_receipt_id": "0xVR"})
            returncode = 0
        return R()

    monkeypatch.setattr(sui_client.subprocess, "run", fake_run)
    out = sui_client.submit_verdict(
        {"pkg": "0xPKG", "registry": "0xREG", "rpc": "https://x", "sk": "0xsk"},
        receipt_id="0xRC", buyer="0xB0B", version=0, task_id=7, pass_bps=5500,
        output_hash="0xdeadbeef", judge0_token="tok", ts=1718000000000, signature_hex="0xsig")
    assert out["verified_receipt_id"] == "0xVR"
    assert captured["payload"]["pass_bps"] == 5500
    assert "mpp-record.ts" in " ".join(captured["cmd"])
