"""FastAPI verifier: receipt-gate -> generate -> Judge0(MPP) -> sign -> record."""
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from verifier.solver import TASKS, generate_solution, score
from verifier.mpp_judge0 import Judge0Client
from verifier.verdict import sign_verdict, pubkey_compressed
from verifier.sui_client import read_model, confirm_receipt, submit_verdict

app = FastAPI(title="Polius Verifier")

ENV = {
    "rpc": os.environ.get("SUI_RPC", "https://fullnode.testnet.sui.io:443"),
    "pkg": os.environ.get("NEXT_PUBLIC_PKG_ID", ""),
    "registry": os.environ.get("NEXT_PUBLIC_MARKET_REGISTRY", ""),
    "sk": os.environ.get("SUI_SUBMITTER_SK", ""),
}
VERIFIER_SK = os.environ.get("VERIFIER_SK", "".join(f"{i:02x}" for i in range(1, 33)))
MPP_MODE = os.environ.get("MPP_MODE", "mock")
# "client" (default): return the signed verdict for the buyer's wallet to submit
#   record_verified_inference itself (no server-side gas key needed).
# "server": the service submits it via scripts/mpp-record.ts (needs SUI_SUBMITTER_SK).
SUBMIT_MODE = os.environ.get("SUBMIT_MODE", "client")


class VerifyReq(BaseModel):
    receipt_id: str
    task_id: int


@app.get("/model")
def model():
    return read_model(ENV["rpc"], ENV["registry"])


@app.post("/verify")
def verify(req: VerifyReq):
    if req.task_id not in TASKS:
        raise HTTPException(404, "unknown task")
    rc = confirm_receipt(ENV["rpc"], req.receipt_id)
    version = rc["version"]
    source = generate_solution(req.task_id, version)
    judge0 = Judge0Client(mode=MPP_MODE)
    pass_bps, output_hash, last_out = score(req.task_id, lambda _s, stdin: judge0.run(source, stdin).stdout)
    sample = judge0.run(source, TASKS[req.task_id].hidden_tests[0][0])
    ts = int(os.environ.get("VERDICT_TS_OVERRIDE", "0")) or _now_ms()
    fields = dict(buyer_hex=rc["buyer"], version=version, task_id=req.task_id,
                  pass_bps=pass_bps, output_hash=output_hash,
                  judge0_token=sample.token, ts=ts)
    sig = sign_verdict(VERIFIER_SK, **fields)
    # The signed verdict — enough for ANYONE to submit record_verified_inference.
    verdict = {
        "registry": ENV["registry"], "receipt_id": req.receipt_id, "buyer": rc["buyer"],
        "version": version, "task_id": req.task_id, "pass_bps": pass_bps,
        "output_hash": "0x" + output_hash.hex(), "judge0_token": sample.token,
        "ts": ts, "signature": "0x" + sig.hex(),
    }
    out = {"solution": source, "status": sample.status, "verified": pass_bps == 10000,
           "pass_bps": pass_bps, "judge0_token": sample.token,
           "output_hash": "0x" + output_hash.hex(), "usdc_pay_digest": sample.usdc_pay_digest,
           "version": version, "verdict": verdict, "submit_mode": SUBMIT_MODE}
    if SUBMIT_MODE == "server":
        rec = submit_verdict(
            {**ENV}, receipt_id=req.receipt_id, buyer=rc["buyer"], version=version,
            task_id=req.task_id, pass_bps=pass_bps, output_hash="0x" + output_hash.hex(),
            judge0_token=sample.token, ts=ts, signature_hex="0x" + sig.hex())
        out["record_digest"] = rec["record_digest"]
        out["verified_receipt_id"] = rec["verified_receipt_id"]
    return out


def _now_ms() -> int:
    import time
    return int(time.time() * 1000)
