"""Read ModelRegistry / Receipt via Sui JSON-RPC; submit verdicts via the TS helper."""
import json
import subprocess
import os
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
