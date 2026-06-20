"""FastAPI verifier: receipt-gate -> generate -> Judge0(MPP) -> sign -> record."""
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from verifier.solver import TASKS, generate_solution, score
from verifier.mpp_judge0 import Judge0Client
from verifier.verdict import sign_verdict, pubkey_compressed
from verifier.sui_client import read_model, confirm_receipt, submit_verdict
from verifier import llm, mpp_llm

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
           "version": version, "verdict": verdict, "submit_mode": SUBMIT_MODE,
           "generator": mpp_llm.generator_name() if mpp_llm.enabled() else llm.generator_name()}
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


# ---- environment deploy + Nautilus-attested verification epoch ----------

import pathlib
from verifier import epoch as epoch_mod
from verifier import nautilus

ENV_STORE = pathlib.Path(os.environ.get("ENV_STORE", str(pathlib.Path(__file__).parent / "deployed_envs")))
SAMPLE_MODEL = os.environ.get("SAMPLE_MODEL", "qwen-0.5b" if os.environ.get("REAL_LLM") == "1" else "stand-in")


class DeployEnvReq(BaseModel):
    name: str
    dataset: list | None = None  # [{question, answer}]; default sort-list set if omitted


class VerifyEnvReq(BaseModel):
    env_id: str
    dataset: list | None = None


@app.post("/deploy-env")
def deploy_env(req: DeployEnvReq):
    """Store a deployed RL environment's dataset; return its hash + artifact uri.

    The on-chain Environment is created by the user's wallet (create_world_entry)
    with the returned artifact_uri; the dataset_hash binds the later epoch attestation.
    """
    dataset = req.dataset or epoch_mod.default_dataset()
    dhash = epoch_mod.dataset_hash(dataset)
    ENV_STORE.mkdir(parents=True, exist_ok=True)
    key = dhash.hex()[:16]
    (ENV_STORE / f"{key}.json").write_text(__import__("json").dumps(
        {"name": req.name, "dataset": dataset}))
    return {"name": req.name, "n_tasks": len(dataset), "dataset_hash": "0x" + dhash.hex(),
            "artifact_uri": f"walrus://env/{key}"}


@app.post("/verify-env")
def verify_env(req: VerifyEnvReq):
    """Run one epoch on the sample OSS LLM, attest the result via Nautilus, and
    return the signed attestation for the wallet to submit `verify_epoch_entry`."""
    dataset = req.dataset
    if dataset is None:
        # try the stored bundle by env, else the default set
        dataset = epoch_mod.default_dataset()
    model_fn = epoch_mod.make_model_fn()
    result = epoch_mod.run_epoch(dataset, model_fn)
    out = {
        "env": req.env_id, "model": SAMPLE_MODEL,
        "n_samples": result["n_samples"], "mean_reward_bps": result["mean_reward_bps"],
        "pass_bps": result["pass_bps"], "dataset_hash": "0x" + result["dataset_hash"].hex(),
    }
    if nautilus.enclave_available():
        # REAL Nitro enclave (Nautilus) attests the result with its TEE-held key.
        att = nautilus.attest_epoch_via_enclave(
            env_id=req.env_id, model=SAMPLE_MODEL, n_samples=result["n_samples"],
            mean_reward_bps=result["mean_reward_bps"], pass_bps=result["pass_bps"],
            dataset_hash=result["dataset_hash"])
        out.update(attester_pk=att["attester_pk"], signature=att["signature"],
                   intent=att["intent"], timestamp_ms=att["timestamp_ms"], attested_by="nitro-enclave")
    else:
        ts = _now_ms()
        sig = nautilus.attest_epoch(
            env_id=req.env_id, model=SAMPLE_MODEL, n_samples=result["n_samples"],
            mean_reward_bps=result["mean_reward_bps"], pass_bps=result["pass_bps"],
            dataset_hash=result["dataset_hash"], timestamp_ms=ts)
        out.update(attester_pk="0x" + nautilus.attester_pk().hex(), signature="0x" + sig.hex(),
                   intent=nautilus.INTENT_SCOPE, timestamp_ms=ts, attested_by="local-seed")
    return out
