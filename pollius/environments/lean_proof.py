"""lean_proof environment -- theorems on disk, scored by the Lean4 verifier.

Layout: data_dir/lean_proof/<problem>/header.lean (theorem statement ending in
":= ") and an optional prompt.txt (NL instruction). The reward assembles
header + the model's response and runs LeanVerifier on it.
"""

from __future__ import annotations

import os

from pollius.environments.base import Task, register_environment
from pollius.verifier import LeanVerifier


@register_environment("lean_proof")
class LeanProofEnv:
    name = "lean_proof"

    def __init__(self, config) -> None:
        self.config = config
        self.root = os.path.join(config.data_dir, "lean_proof")

    def _problems(self):
        out = []
        if not os.path.isdir(self.root):
            return out
        for name in sorted(os.listdir(self.root)):
            pdir = os.path.join(self.root, name)
            header_path = os.path.join(pdir, "header.lean")
            prompt_path = os.path.join(pdir, "prompt.txt")
            if not os.path.isfile(header_path):
                continue
            with open(header_path) as f:
                header = f.read()
            if os.path.isfile(prompt_path):
                with open(prompt_path) as f:
                    prompt = f.read().strip()
            else:
                prompt = header
            out.append((name, header, prompt))
        return out

    def sample_tasks(self, n: int, rng) -> list:
        probs = self._problems()
        if not probs:
            return []
        if n <= len(probs):
            idx = rng.permutation(len(probs))[:n]
        else:
            idx = rng.integers(0, len(probs), size=n)
        return [
            Task("lean_proof", probs[i][0], probs[i][2], {"header": probs[i][1]})
            for i in idx
        ]

    def reward(self, task: Task, response_text: str, config) -> float:
        source = task.extra["header"] + "\n" + response_text + "\n"
        ok, _ = LeanVerifier(config).verify(source)
        return 1.0 if ok else 0.0
