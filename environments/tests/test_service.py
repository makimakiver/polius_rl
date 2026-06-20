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
