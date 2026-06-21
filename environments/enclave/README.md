# Polius attestation enclave

The TEE that signs env-verification epoch results. Runs inside an **AWS Nitro
enclave** (deployed via **Marlin Oyster**, `oyster-cvm`) and exposes:

| endpoint | method | purpose |
| --- | --- | --- |
| `/health` | GET | liveness |
| `/public-key` | GET | the enclave's 33-byte secp256k1 attester pubkey |
| `/attest-epoch` | POST | sign an epoch result (the call the verifier makes) |

`/attest-epoch` BCS-encodes `IntentMessage{intent, timestamp_ms, EpochPayload}`
**byte-for-byte identically** to:
- `environments/verifier/nautilus.py::bcs_epoch()` (off-chain signer mirror)
- `contracts/sources/env_verifier.move::EpochPayload` (on-chain verifier)

so the signature passes `ecdsa_k1::secp256k1_verify` in `verify_epoch` on Sui. The
signing key is generated/sealed **inside the TEE** — it never leaves the enclave.

## Files
- `server.py` — the Flask attestation server (this is the enclave logic)
- `requirements.txt` — `flask`, `coincurve`
- `Dockerfile` — reproducible-ish arm64 image
- `docker-compose.yml` — Oyster deployment config (pinned `@sha256` image)
- `build_deploy.sh` — build → push → repin → `oyster-cvm deploy` (20h default)

## Run locally (test the signing without a TEE)
```bash
python3 - <<'PY'                      # make a throwaway 32-byte key
import os; open("/tmp/ecdsa.sec","wb").write(os.urandom(32))
PY
pip install flask coincurve
python3 server.py /tmp/ecdsa.sec      # serves on :3000
# in another shell:
curl -s localhost:3000/public-key
curl -s -X POST localhost:3000/attest-epoch -H 'content-type: application/json' \
  -d '{"env_id":"0x0","model":"qwen-0.5b","n_samples":10,"mean_reward_bps":3000,"pass_bps":3000,"dataset_hash":"0xabcd"}'
```

## Deploy on Oyster (paid — run yourself)
The final `oyster-cvm deploy` spends real USDC (~2 for 20h) and needs your wallet,
so an agent/CI can't authorize it.
```bash
echo 'PRIVATE_KEY=suiprivkey1...' > .deploy.env   # untracked; wallet with SUI + USDC
./build_deploy.sh                                  # builds, pushes, deploys for 20h (DURATION_MIN=1200)
```
A fresh deploy gets a **new IP**. Wire it in and restart the verifier:
```bash
# in repo root .env.local:
ENCLAVE_URL=http://<NEW_IP>:3000
# then:
cd environments && REAL_LLM=1 ENCLAVE_URL=http://<NEW_IP>:3000 LEAN_TIMEOUT=40 \
  python3 -m uvicorn verifier.service:app --port 8077
```
The verifier auto-uses the enclave when reachable (`attested_by: nitro-enclave`) and
falls back to the local seed key if it's down. Verify the enclave independently with
`oyster-cvm verify --enclave-ip <NEW_IP>`.

> For byte-reproducible PCRs (so the imageId is stable / registerable), build via the
> nix flow in `../../../nautilus_practice` rather than a plain `docker build`.
