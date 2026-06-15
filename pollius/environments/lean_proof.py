"""lean_proof environment -- theorems on disk, scored by the Lean4 verifier.

Layout: data_dir/lean_proof/<problem>/header.lean (theorem statement ending in
":= ") and an optional prompt.txt (NL instruction). `verify` assembles
header + the model's response and runs LeanVerifier on it.
"""

from __future__ import annotations

import os

from pollius.environments.base import (
    LeanVerifier,
    Task,
    VerifiedEnvironment,
    iter_problem_dirs,
    register_environment,
)


@register_environment("lean_proof")
class LeanProofEnv(VerifiedEnvironment):
    name = "lean_proof"

    def load_tasks(self) -> list:
        tasks = []
        for pid, pdir in iter_problem_dirs(self.root):
            header_path = os.path.join(pdir, "header.lean")
            if not os.path.isfile(header_path):
                continue
            with open(header_path) as f:
                header = f.read()
            prompt_path = os.path.join(pdir, "prompt.txt")
            if os.path.isfile(prompt_path):
                with open(prompt_path) as f:
                    prompt = f.read().strip()
            else:
                prompt = header
            tasks.append(Task(self.name, pid, prompt, {"header": header}))
        return tasks

    def verify(self, task: Task, response_text: str, config) -> bool:
        source = task.extra["header"] + "\n" + response_text + "\n"
        ok, _ = LeanVerifier(config).verify(source)
        return ok
