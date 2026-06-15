"""The Environment box -- a task type's question source + verifier.

Adding a new task type is "drop one file in this folder". The easy path is to
subclass `VerifiedEnvironment` and implement just two methods:

    class MyEnv(VerifiedEnvironment):
        name = "my_task"
        def load_tasks(self):                       # where questions come from
            ...                                     # -> list[Task]
        def verify(self, task, response, config):   # the verifier (pass/fail)
            ...                                     # -> bool

Everything else -- the data folder, sampling, and the 0/1 reward -- is inherited,
and the env is auto-discovered (see dispatch.py), so no wiring is needed. For full
control you can instead implement the `Environment` protocol directly.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from dataclasses import dataclass, field
from typing import Dict, Protocol, Tuple

from pollius.registry import make_registry

register_environment, get_environment, ENVIRONMENT_REGISTRY = make_registry(
    "environment"
)


@dataclass
class Task:
    """One question plus the ground truth its environment needs to score it."""

    env: str                       # which environment produced it
    problem_id: str                # stable id, also used as the group key
    prompt: str                    # the question shown to the model
    extra: dict = field(default_factory=dict)  # answer key / lean header / checker


class Environment(Protocol):
    """A task type. Implementations self-register with @register_environment."""

    name: str

    def sample_tasks(self, n: int, rng) -> list:  # list[Task]
        """Return up to `n` Tasks (fewer if the env has fewer problems)."""
        ...

    def reward(self, task: Task, response_text: str, config) -> float:
        """Score a generated response for `task`. Convention: 1.0 pass / 0.0 fail."""
        ...


def iter_problem_dirs(root: str):
    """Yield ``(problem_id, dir_path)`` for each subfolder of `root`, sorted.

    Empty if `root` is missing. The standard helper for folder-backed envs.
    """
    if not os.path.isdir(root):
        return
    for name in sorted(os.listdir(root)):
        path = os.path.join(root, name)
        if os.path.isdir(path):
            yield name, path


class VerifiedEnvironment:
    """Base for environments whose reward is a 0/1 pass from a verifier.

    Tasks live under ``data_dir/<name>/`` (``self.root``). A subclass implements
    only `load_tasks` (produce the questions) and `verify` (the checker); the
    sampling and reward wiring below are inherited and shared by every env.
    """

    name: str = ""

    def __init__(self, config) -> None:
        self.config = config
        self.root = os.path.join(config.data_dir, self.name)

    # --- the two hooks a new environment / verifier implements ---------------
    def load_tasks(self) -> list:
        """Return the env's full list of `Task`s (from disk, a generator, ...)."""
        raise NotImplementedError

    def verify(self, task: Task, response_text: str, config) -> bool:
        """The verifier: True iff `response_text` solves `task`."""
        raise NotImplementedError

    # --- inherited machinery: sampling + reward ------------------------------
    def sample_tasks(self, n: int, rng) -> list:
        tasks = self.load_tasks()
        if not tasks:
            return []
        if n <= len(tasks):
            idx = rng.permutation(len(tasks))[:n]
        else:
            idx = rng.integers(0, len(tasks), size=n)
        return [tasks[i] for i in idx]

    def reward(self, task: Task, response_text: str, config) -> float:
        return 1.0 if self.verify(task, response_text, config) else 0.0


class LeanVerifier:
    """Shells out to `lake env lean` on a temp file. Real-only: raises if the Lean
    toolchain is absent. Accepts a proof only if it compiles AND has no
    `sorry`/`admit` (which compile with a warning but prove nothing)."""

    def __init__(self, config) -> None:
        self.config = config

    def verify(self, lean_source: str) -> Tuple[bool, Dict[str, str]]:
        lake = shutil.which("lake")
        if lake is None:
            raise RuntimeError(
                "Lean toolchain not found: 'lake' is not on PATH. Install elan/Lean "
                "(https://leanprover.github.io/) and set config.lean_project_dir to a "
                "Lake project."
            )
        proj = self.config.lean_project_dir
        os.makedirs(proj, exist_ok=True)
        tmp = os.path.join(proj, f"_pollius_tmp_{uuid.uuid4().hex}.lean")
        with open(tmp, "w") as f:
            f.write(lean_source)
        stderr = ""
        try:
            result = subprocess.run(
                [lake, "env", "lean", os.path.basename(tmp)],
                cwd=proj,
                capture_output=True,
                text=True,
                timeout=self.config.lean_timeout_s,
            )
            ok = result.returncode == 0
            stderr = result.stderr or ""
        except subprocess.TimeoutExpired:
            ok, stderr = False, "timeout"
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)
        if self.config.reject_sorry and (
            "sorry" in lean_source or "admit" in lean_source or "uses 'sorry'" in stderr
        ):
            ok = False
        return ok, {"stderr": stderr[:500]}
