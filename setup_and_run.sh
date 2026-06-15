#!/usr/bin/env bash
# End-to-end: set up a fresh box (Python deps + Lean toolchain + lake project)
# then run lean_proof RL training with the before/after eval.
#
# Idempotent — safe to re-run; it skips anything already installed.
#
# Usage:
#   bash setup_and_run.sh                     # full setup, then 20 training steps
#   STEPS=50 bash setup_and_run.sh            # longer run
#   MODEL=/root/qwen-0.5b bash setup_and_run.sh   # use a local model dir
#   SETUP_ONLY=1 bash setup_and_run.sh        # install everything, don't train
set -euo pipefail

cd "$(dirname "$0")"
REPO="$PWD"

MODEL="${MODEL:-Qwen/Qwen2.5-0.5B-Instruct}"
ENVS="${ENVS:-lean_proof}"
STEPS="${STEPS:-40}"
NUM_PROMPTS="${NUM_PROMPTS:-13}"   # = number of lean_proof problems, so every one is trained each step
GROUP_SIZE="${GROUP_SIZE:-8}"
MAX_NEW_TOKENS="${MAX_NEW_TOKENS:-64}"   # room for full induction blocks
LEAN_TOOLCHAIN="leanprover/lean4:v4.30.0"

log() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Python dependencies
# ---------------------------------------------------------------------------
log "Python deps (numpy, transformers; torch only if missing)"
python -m pip install --upgrade pip >/dev/null
# Don't reinstall torch if a CUDA build is already present (e.g. RunPod images).
if ! python -c "import torch" 2>/dev/null; then
  echo "torch not found -> installing CPU/CUDA wheel from default index"
  python -m pip install torch
else
  echo "torch present: $(python -c 'import torch; print(torch.__version__)')"
fi
python -m pip install --upgrade "transformers>=4.44" numpy

# ---------------------------------------------------------------------------
# 2. Lean toolchain (elan -> lake/lean), pinned to the project's version
# ---------------------------------------------------------------------------
export PATH="$HOME/.elan/bin:$PATH"
if ! command -v lake >/dev/null 2>&1; then
  log "Installing elan + Lean $LEAN_TOOLCHAIN"
  curl -fsSL https://elan.lean-lang.org/elan-init.sh \
    | sh -s -- -y --default-toolchain "$LEAN_TOOLCHAIN"
  export PATH="$HOME/.elan/bin:$PATH"
else
  echo "lake present: $(lake --version | head -1)"
fi

# ---------------------------------------------------------------------------
# 3. Lean lake project (gitignored -> regenerate if absent), then warm-build
# ---------------------------------------------------------------------------
LP="$REPO/lean_project"
if [ ! -f "$LP/lakefile.toml" ]; then
  log "Creating lean_project (core Lean, no mathlib)"
  mkdir -p "$LP/LeanProject"
  cat > "$LP/lean-toolchain" <<EOF
$LEAN_TOOLCHAIN
EOF
  cat > "$LP/lakefile.toml" <<'EOF'
name = "lean_project"
version = "0.1.0"
defaultTargets = ["lean_project"]

[[lean_lib]]
name = "LeanProject"

[[lean_exe]]
name = "lean_project"
root = "Main"
EOF
  cat > "$LP/Main.lean" <<'EOF'
import LeanProject

def main : IO Unit :=
  IO.println s!"Hello, {hello}!"
EOF
  cat > "$LP/LeanProject.lean" <<'EOF'
-- This module serves as the root of the `LeanProject` library.
import LeanProject.Basic
EOF
  cat > "$LP/LeanProject/Basic.lean" <<'EOF'
def hello := "world"
EOF
else
  echo "lean_project already present"
fi

log "Warming the lake project (downloads toolchain on first run)"
( cd "$LP" && lake build )

# Sanity: the verifier path must accept a real proof.
log "Verifier smoke test (theorem n + 0 = n := by simp)"
( cd "$LP" && printf 'theorem _smoke (n : Nat) : n + 0 = n := by simp\n' > _smoke.lean \
  && lake env lean _smoke.lean && echo "  lean OK" ; rm -f _smoke.lean )

if [ "${SETUP_ONLY:-0}" = "1" ]; then
  log "SETUP_ONLY=1 -> done (skipping training)"
  exit 0
fi

# ---------------------------------------------------------------------------
# 4. Train + before/after eval
# ---------------------------------------------------------------------------
log "Training: model=$MODEL envs=$ENVS steps=$STEPS"
export PYTHONUNBUFFERED=1
python train_pollius_torch.py \
  --model "$MODEL" \
  --environments "$ENVS" \
  --steps "$STEPS" \
  --num-prompts "$NUM_PROMPTS" \
  --group-size "$GROUP_SIZE" \
  --max-new-tokens "$MAX_NEW_TOKENS" \
  --compare
