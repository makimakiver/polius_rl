#!/usr/bin/env bash
# Evaluate the sort-list env with vf-eval against a hosted OpenAI-compatible
# provider. Defaults to Fireworks + Qwen2.5-7B.
#
# Usage:
#   export FIREWORKS_API_KEY=fw_...        # your provider key
#   ./eval.sh                              # 5 examples
#   ./eval.sh 20                           # N examples
#
# Override the provider without editing this file:
#   MODEL=...  BASE_URL=...  KEY_VAR=...  ./eval.sh
set -euo pipefail
cd "$(dirname "$0")"

N="${1:-5}"
MODEL="${MODEL:-accounts/fireworks/models/qwen2p5-7b-instruct}"
BASE_URL="${BASE_URL:-https://api.fireworks.ai/inference/v1}"
KEY_VAR="${KEY_VAR:-FIREWORKS_API_KEY}"

if [ -z "${!KEY_VAR:-}" ]; then
  echo "error: \$$KEY_VAR is not set. Run: export $KEY_VAR=<your key>" >&2
  exit 1
fi

uv run vf-install sort-list -p . >/dev/null 2>&1 || true
uv run vf-eval sort-list -m "$MODEL" -b "$BASE_URL" -k "$KEY_VAR" -n "$N"
