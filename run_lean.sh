#!/usr/bin/env bash
# Run the lean_proof RL loop with the local Qwen model.
# Usage:  bash run_lean.sh            # 1 step, quick
#         STEPS=20 bash run_lean.sh   # longer run
set -euo pipefail

export PATH="$HOME/.elan/bin:$PATH"        # make lake/lean visible
cd "$(dirname "$0")"                        # run from the project dir

MODEL="${MODEL:-/Users/makimakiver/qwen-0.5b}"
ENVS="${ENVS:-lean_proof}"
STEPS="${STEPS:-10}"
NUM_PROMPTS="${NUM_PROMPTS:-2}"
GROUP_SIZE="${GROUP_SIZE:-4}"
MAX_NEW_TOKENS="${MAX_NEW_TOKENS:-8}"

echo "lake: $(command -v lake || echo 'NOT FOUND')"
python train_pollius_torch.py \
  --model "$MODEL" \
  --environments "$ENVS" \
  --steps "$STEPS" \
  --num-prompts "$NUM_PROMPTS" \
  --group-size "$GROUP_SIZE" \
  --max-new-tokens "$MAX_NEW_TOKENS"
