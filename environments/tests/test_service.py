from fastapi.testclient import TestClient
from verifier import service


def test_verify_client_mode_returns_signed_verdict(monkeypatch):
    # Default SUBMIT_MODE="client": the service signs but does NOT submit; the
    # buyer's wallet records the verdict, so the response carries the signed verdict.
    monkeypatch.setattr(service, "SUBMIT_MODE", "client")
    monkeypatch.setattr(service, "confirm_receipt",
                        lambda rpc, rid: {"buyer": "0xB0B", "version": 3, "task_id": 7})
    client = TestClient(service.app)
    r = client.post("/verify", json={"receipt_id": "0xRC", "task_id": 7})
    body = r.json()
    assert r.status_code == 200
    assert body["verified"] is True and body["pass_bps"] == 10000
    assert body["judge0_token"].startswith("mock_")
    assert "record_digest" not in body
    v = body["verdict"]
    assert v["receipt_id"] == "0xRC" and v["buyer"] == "0xB0B" and v["pass_bps"] == 10000
    assert v["signature"].startswith("0x") and len(v["signature"]) == 2 + 128  # 64-byte sig hex


def test_verify_server_mode_submits(monkeypatch):
    monkeypatch.setattr(service, "SUBMIT_MODE", "server")
    monkeypatch.setattr(service, "confirm_receipt",
                        lambda rpc, rid: {"buyer": "0xB0B", "version": 3, "task_id": 7})
    monkeypatch.setattr(service, "submit_verdict",
                        lambda env, **f: {"record_digest": "0xREC", "verified_receipt_id": "0xVR"})
    client = TestClient(service.app)
    body = client.post("/verify", json={"receipt_id": "0xRC", "task_id": 7}).json()
    assert body["record_digest"] == "0xREC"
    assert body["verified_receipt_id"] == "0xVR"
