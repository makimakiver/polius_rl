"""Test the lean_proof RL environment with the LOCAL Qwen model.

Drives the real LeanProofEnv + TorchPolicy with /Users/makimakiver/qwen-0.5b:
  sample lean tasks -> generate proof attempts -> attempt reward.
The reward step needs a Lean toolchain (lake); we catch its absence so the
generation half can still be verified locally.

    python test_lean_local_model.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pollius.core import PolliusConfig
from pollius.environments.lean_proof import LeanProofEnv
from pollius.backends.torch_llm import TorchPolicy

LOCAL_MODEL = "/Users/makimakiver/qwen-0.5b"
GROUP_SIZE = 2

cfg = PolliusConfig(
    model_name=LOCAL_MODEL,
    environments=("lean_proof",),
    data_dir="data",
    group_size=GROUP_SIZE,
    max_new_tokens=64,
    device="auto",
)

print(f"== loading local model: {cfg.model_name}")
policy = TorchPolicy(cfg)
print(f"== device: {policy.device}")

env = LeanProofEnv(cfg)
import numpy as np
tasks = env.sample_tasks(2, np.random.default_rng(0))
print(f"== lean tasks: {[t.problem_id for t in tasks]}\n")

for task in tasks:
    print(f"#### problem: {task.problem_id}")
    print(f"header   : {task.extra['header'].strip()}")
    print(f"prompt   : {task.prompt}")
    grp = policy.generate(task.prompt, GROUP_SIZE)
    for i, resp in enumerate(grp.response_texts):
        snippet = resp.strip().replace("\n", " ")[:160]
        print(f"  gen[{i}] : {snippet}")
        # full lean source the verifier WOULD compile:
        source = task.extra["header"] + "\n" + resp.strip() + "\n"
        try:
            reward = env.reward(task, resp.strip(), cfg)
            print(f"  reward  : {reward}")
        except RuntimeError as e:
            print(f"  reward  : SKIPPED (no Lean toolchain) -> {str(e).splitlines()[0]}")
    print()
