#!/usr/bin/env bash
# One-shot Polius demo loop: ensure the verifier is up (real model + Lean + Nitro
# enclave), then deploy the lean-prover env with a Nautilus-attested epoch.
#
# Usage (from anywhere):  ./scripts/demo.sh ["env name"] [bundle-dir]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"   # repo root, so cwd never matters
cd "$ROOT"

NAME="${1:-demo prover}"
BUNDLE="${2:-examples/envs/lean-prover}"
PORT="${VERIFIER_PORT:-8077}"

[ -f .env.local ] || { echo "✗ .env.local missing in $ROOT"; exit 1; }
PKG=$(grep -E '^NEXT_PUBLIC_PKG_ID=' .env.local | cut -d= -f2- | tr -d '"')
ENCLAVE=$(grep -E '^ENCLAVE_URL=' .env.local | cut -d= -f2- | tr -d '"')
[ -n "$PKG" ] || { echo "✗ NEXT_PUBLIC_PKG_ID missing in .env.local"; exit 1; }
echo "▸ pkg      : ${PKG:0:14}…"
echo "▸ enclave  : ${ENCLAVE:-<none — will attest with local seed>}"

# 1. ensure the verifier is up (real Qwen + Lean grader + enclave wired)
if curl -s -m3 -o /dev/null "http://localhost:$PORT/openapi.json" 2>/dev/null; then
  echo "▸ verifier : already running on :$PORT"
else
  echo "▸ verifier : starting on :$PORT (loads Qwen-0.5B + Lean)…"
  ( cd environments && PATH="$HOME/.elan/bin:$PATH" REAL_LLM=1 ENCLAVE_URL="$ENCLAVE" LEAN_TIMEOUT=40 \
      nohup python3 -m uvicorn verifier.service:app --port "$PORT" --log-level warning \
      > /tmp/verifier_demo.log 2>&1 & )
  for i in $(seq 1 40); do
    curl -s -m3 -o /dev/null "http://localhost:$PORT/openapi.json" 2>/dev/null && break
    sleep 1
  done
  curl -s -m3 -o /dev/null "http://localhost:$PORT/openapi.json" || { echo "✗ verifier failed to start (see /tmp/verifier_demo.log)"; exit 1; }
  echo "▸ verifier : up"
fi

# 2. deploy the env with an attested epoch (verify → Walrus → on-chain → Nautilus attest)
echo "▸ deploying \"$NAME\" with --epoch …"
PY_VERIFIER_URL="http://localhost:$PORT" npm run env -- deploy "$BUNDLE" --epoch --name "$NAME"
