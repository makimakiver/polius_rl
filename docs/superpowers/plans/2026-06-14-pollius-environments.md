# pollius Environments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pluggable `Environment` box to pollius — a fourth self-registering registry that bundles each task type's question source and reward rule — shipping with `lean_proof` (real Lean4 verifier) and `logic_quiz` (answer-match) environments, plus a `pass@k` metric and an env-dispatched reward helper.

**Architecture:** Each `Environment` exposes `sample_tasks()` and `reward()`. A `Task` carries the prompt and env-specific ground truth. Samples are tagged with their originating env, so a mixed batch is scored per-sample by dispatching to the right environment. The Lean verifier shells out to `lake env lean`, failing loud when the toolchain is absent. `pass@k` and rewards are per-group and env-agnostic. This is phases 1–4 of the design spec; the torch training backend (phases 5–6) is a separate plan.

**Tech Stack:** Python 3.13, numpy, stdlib `subprocess`/`shutil`/`json`, pytest. No torch, no model, no network needed for this plan. Real Lean tests skip when `lake` is absent.

**Spec:** `docs/superpowers/specs/2026-06-14-pollius-environments-torch-training-design.md`

---

### Task 1: Config fields + Environment base (registry + Task)

**Files:**
- Modify: `pollius/config.py`
- Create: `pollius/environments/__init__.py`
- Create: `pollius/environments/base.py`
- Test: `tests/test_environments.py`

- [ ] **Step 1: Add config fields**

In `pollius/config.py`, add these fields to the `PolliusConfig` dataclass, after the existing `--- training loop ---` block (before `__post_init__`):

```python
    # --- environments / data / eval (phase 1-4) ---------------------------
    environments: tuple = ("lean_proof",)   # which envs to draw tasks from
    data_dir: str = "data"
    lean_project_dir: str = "lean_project"  # must hold a lakefile + toolchain
    lean_timeout_s: float = 30.0
    reject_sorry: bool = True
    pass_at_k_values: tuple = (1, 4)
```

- [ ] **Step 2: Write the Environment base**

Create `pollius/environments/__init__.py` (empty file):

```python
```

Create `pollius/environments/base.py`:

```python
"""The Environment box -- a task type's question source + reward rule.

An Environment bundles two things behind one interface so new task types are
"write one registered class": where questions come from (`sample_tasks`) and how
an answer is scored (`reward`). Each Sample is tagged with the env that produced
it, so a mixed batch is scored per-sample by dispatching to the right env.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

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
```

- [ ] **Step 3: Write the failing test**

Create `tests/test_environments.py`:

```python
"""Tests for the Environment box. Run: python3 -m pytest tests/test_environments.py -q"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.environments.base import (
    ENVIRONMENT_REGISTRY,
    Task,
    get_environment,
    make_registry,
    register_environment,
)


def test_task_defaults_extra_to_empty_dict():
    t = Task(env="x", problem_id="p1", prompt="q")
    assert t.extra == {}
    assert t.env == "x" and t.problem_id == "p1" and t.prompt == "q"


def test_environment_registry_register_and_get():
    reg, get, table = make_registry("tmp-env")

    @reg("demo")
    class DemoEnv:
        name = "demo"

    assert get("demo") is DemoEnv
    assert "demo" in table
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_environments.py -q`
Expected: PASS (2 passed). `make_registry` is re-exported into `base` via the import, so the test import resolves.

- [ ] **Step 5: Commit**

```bash
git add pollius/config.py pollius/environments/ tests/test_environments.py
git commit -m "feat: add Environment registry, Task type, and config fields"
```

---

### Task 2: pass@k metric

**Files:**
- Create: `pollius/metrics.py`
- Test: `tests/test_metrics.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_metrics.py`:

```python
"""Tests for pass@k. Run: python3 -m pytest tests/test_metrics.py -q"""

from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.metrics import pass_at_k


def test_pass_at_1_is_fraction_correct():
    # one problem, 5 samples, 2 correct -> pass@1 = 2/5 = 0.4
    rewards = np.array([1.0, 1.0, 0.0, 0.0, 0.0])
    groups = np.array([0, 0, 0, 0, 0])
    per_problem, mean = pass_at_k(rewards, groups, k=1)
    assert math.isclose(per_problem[0], 0.4)
    assert math.isclose(mean, 0.4)


def test_pass_at_k_equals_one_when_k_covers_all():
    rewards = np.array([1.0, 1.0, 0.0, 0.0, 0.0])  # c=2, n=5
    groups = np.array([0, 0, 0, 0, 0])
    _, mean = pass_at_k(rewards, groups, k=5)  # k >= n-c+1 -> guaranteed a pass
    assert math.isclose(mean, 1.0)


def test_pass_at_k_zero_when_none_correct():
    rewards = np.zeros(4)
    groups = np.array([0, 0, 0, 0])
    per_problem, mean = pass_at_k(rewards, groups, k=2)
    assert per_problem[0] == 0.0 and mean == 0.0


def test_pass_at_k_averages_over_problems():
    # problem 0: 1/2 correct; problem 1: 0/2 correct -> mean pass@1 = (0.5+0)/2
    rewards = np.array([1.0, 0.0, 0.0, 0.0])
    groups = np.array([0, 0, 1, 1])
    _, mean = pass_at_k(rewards, groups, k=1)
    assert math.isclose(mean, 0.25)


def test_pass_at_k_skips_groups_smaller_than_k():
    rewards = np.array([1.0, 0.0])  # n=2
    groups = np.array([0, 0])
    per_problem, mean = pass_at_k(rewards, groups, k=5)  # k > n -> skipped
    assert math.isnan(per_problem[0])
    assert math.isnan(mean)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_metrics.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'pollius.metrics'`

- [ ] **Step 3: Write the implementation**

Create `pollius/metrics.py`:

```python
"""Evaluation metrics. pass@k uses the unbiased Codex estimator.

For a problem with n samples of which c pass:

    pass@k = 1 - C(n-c, k) / C(n, k)

computed via math.comb (exact integers, no factorial overflow). Groups with
n < k are skipped (reported as NaN and excluded from the mean).
"""

from __future__ import annotations

from math import comb
from typing import Dict, Tuple

import numpy as np


def _pass_at_k_single(n: int, c: int, k: int) -> float:
    if k > n:
        return float("nan")
    if c == 0:
        return 0.0
    if n - c < k:        # too few failures to fill k slots -> a pass is guaranteed
        return 1.0
    return 1.0 - comb(n - c, k) / comb(n, k)


def pass_at_k(rewards, group_ids, k: int) -> Tuple[Dict[int, float], float]:
    """Per-problem pass@k and the mean over problems.

    `rewards` are per-sample scores; any value > 0 counts as a pass. Returns
    ``(per_problem: {group_id -> pass@k}, mean over non-NaN problems)``.
    """
    rewards = np.asarray(rewards, dtype=np.float64)
    group_ids = np.asarray(group_ids)

    per_problem: Dict[int, float] = {}
    for g in np.unique(group_ids):
        members = group_ids == g
        n = int(members.sum())
        c = int((rewards[members] > 0).sum())
        per_problem[int(g)] = _pass_at_k_single(n, c, k)

    valid = [v for v in per_problem.values() if not np.isnan(v)]
    mean = float(np.mean(valid)) if valid else float("nan")
    return per_problem, mean
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_metrics.py -q`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add pollius/metrics.py tests/test_metrics.py
git commit -m "feat: add pass@k metric (unbiased estimator)"
```

---

### Task 3: LeanVerifier

**Files:**
- Create: `pollius/verifier.py`
- Test: `tests/test_verifier.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_verifier.py`. These tests monkeypatch `shutil.which` and `subprocess.run` so they run with no real Lean toolchain:

```python
"""Tests for LeanVerifier. Run: python3 -m pytest tests/test_verifier.py -q"""

from __future__ import annotations

import os
import subprocess
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius import verifier as V
from pollius.config import PolliusConfig


class _Result:
    def __init__(self, returncode, stderr=""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = ""


def _cfg(tmp_path):
    return PolliusConfig(lean_project_dir=str(tmp_path), reject_sorry=True)


def test_missing_lake_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: None)
    with pytest.raises(RuntimeError):
        V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := trivial")


def test_returncode_zero_is_ok(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", lambda *a, **k: _Result(0))
    ok, detail = V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := trivial")
    assert ok is True


def test_nonzero_returncode_fails(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", lambda *a, **k: _Result(1, "error: unknown identifier"))
    ok, detail = V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := nonsense")
    assert ok is False
    assert "unknown identifier" in detail["stderr"]


def test_sorry_is_rejected_even_if_returncode_zero(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", lambda *a, **k: _Result(0, "warning: declaration uses 'sorry'"))
    ok, _ = V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := by sorry")
    assert ok is False


def test_timeout_fails(monkeypatch, tmp_path):
    def _boom(*a, **k):
        raise subprocess.TimeoutExpired(cmd="lake", timeout=1)
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", _boom)
    ok, detail = V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := trivial")
    assert ok is False and detail["stderr"] == "timeout"


def test_tempfile_is_cleaned_up(monkeypatch, tmp_path):
    monkeypatch.setattr(V.shutil, "which", lambda _: "/usr/bin/lake")
    monkeypatch.setattr(V.subprocess, "run", lambda *a, **k: _Result(0))
    V.LeanVerifier(_cfg(tmp_path)).verify("theorem t : True := trivial")
    leftovers = [f for f in os.listdir(tmp_path) if f.startswith("_pollius_tmp_")]
    assert leftovers == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_verifier.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'pollius.verifier'`

- [ ] **Step 3: Write the implementation**

Create `pollius/verifier.py`:

```python
"""Lean4 proof verifier -- shells out to `lake env lean` on a temp file.

Real-only by choice: if the Lean toolchain is absent, `verify` RAISES rather
than silently passing. A proof is accepted only if Lean compiles it AND it
contains no `sorry`/`admit` (which compile with a warning but prove nothing).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import uuid
from typing import Dict, Tuple


class LeanVerifier:
    def __init__(self, config) -> None:
        self.config = config

    def verify(self, lean_source: str) -> Tuple[bool, Dict[str, str]]:
        """Return ``(ok, {"stderr": ...})``. Raises if `lake` is not on PATH."""
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
                [lake, "env", "lean", tmp],
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
            "sorry" in lean_source
            or "admit" in lean_source
            or "uses 'sorry'" in stderr
        ):
            ok = False

        return ok, {"stderr": stderr[:500]}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_verifier.py -q`
Expected: PASS (6 passed)

- [ ] **Step 5: Commit**

```bash
git add pollius/verifier.py tests/test_verifier.py
git commit -m "feat: add LeanVerifier (fail-loud, sorry-rejecting)"
```

---

### Task 4: lean_proof environment + example data

**Files:**
- Create: `pollius/environments/lean_proof.py`
- Create: `data/lean_proof/add_zero/header.lean`
- Create: `data/lean_proof/add_zero/prompt.txt`
- Create: `data/lean_proof/mul_one/header.lean`
- Create: `data/lean_proof/mul_one/prompt.txt`
- Test: `tests/test_env_lean_proof.py`

- [ ] **Step 1: Create the example data**

Create `data/lean_proof/add_zero/header.lean` (Mathlib-free core Lean):

```lean
theorem add_zero_demo (n : Nat) : n + 0 = n :=
```

Create `data/lean_proof/add_zero/prompt.txt`:

```
Prove in Lean 4 that for any natural number n, n + 0 = n. Output only the proof term or tactic block that completes the theorem.
```

Create `data/lean_proof/mul_one/header.lean`:

```lean
theorem mul_one_demo (n : Nat) : n * 1 = n :=
```

Create `data/lean_proof/mul_one/prompt.txt`:

```
Prove in Lean 4 that for any natural number n, n * 1 = n. Output only the proof term or tactic block that completes the theorem.
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_env_lean_proof.py`:

```python
"""Tests for LeanProofEnv. Run: python3 -m pytest tests/test_env_lean_proof.py -q"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig
from pollius.environments.base import ENVIRONMENT_REGISTRY
from pollius.environments.lean_proof import LeanProofEnv


def test_lean_proof_is_registered():
    assert "lean_proof" in ENVIRONMENT_REGISTRY


def test_sample_tasks_reads_problem_folders():
    env = LeanProofEnv(PolliusConfig(data_dir="data"))
    tasks = env.sample_tasks(2, np.random.default_rng(0))
    ids = sorted(t.problem_id for t in tasks)
    assert ids == ["add_zero", "mul_one"]
    for t in tasks:
        assert t.env == "lean_proof"
        assert "header" in t.extra and "theorem" in t.extra["header"]
        assert t.prompt  # non-empty


def test_sample_tasks_empty_when_dir_missing():
    env = LeanProofEnv(PolliusConfig(data_dir="does_not_exist"))
    assert env.sample_tasks(3, np.random.default_rng(0)) == []


def test_reward_raises_without_lake(monkeypatch):
    # reward delegates to LeanVerifier, which fails loud when lake is absent.
    from pollius import verifier as V
    monkeypatch.setattr(V.shutil, "which", lambda _: None)
    env = LeanProofEnv(PolliusConfig(data_dir="data"))
    task = env.sample_tasks(1, np.random.default_rng(0))[0]
    import pytest
    with pytest.raises(RuntimeError):
        env.reward(task, "by simp", PolliusConfig(data_dir="data"))
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python3 -m pytest tests/test_env_lean_proof.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'pollius.environments.lean_proof'`

- [ ] **Step 4: Write the implementation**

Create `pollius/environments/lean_proof.py`:

```python
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m pytest tests/test_env_lean_proof.py -q`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add pollius/environments/lean_proof.py data/lean_proof tests/test_env_lean_proof.py
git commit -m "feat: add lean_proof environment + example theorems"
```

---

### Task 5: logic_quiz environment + example data

**Files:**
- Create: `pollius/environments/logic_quiz.py`
- Create: `data/logic_quiz/parity/task.json`
- Create: `data/logic_quiz/next_num/task.json`
- Test: `tests/test_env_logic_quiz.py`

- [ ] **Step 1: Create the example data**

Create `data/logic_quiz/parity/task.json`:

```json
{"prompt": "Is the number 7 even or odd? Reply with 'Answer: even' or 'Answer: odd'.", "answer": "odd"}
```

Create `data/logic_quiz/next_num/task.json`:

```json
{"prompt": "What is the next number in the sequence 2, 4, 6, 8? End with 'Answer: <number>'.", "answer": "10"}
```

- [ ] **Step 2: Write the failing test**

Create `tests/test_env_logic_quiz.py`:

```python
"""Tests for LogicQuizEnv. Run: python3 -m pytest tests/test_env_logic_quiz.py -q"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig
from pollius.environments.base import ENVIRONMENT_REGISTRY
from pollius.environments.logic_quiz import LogicQuizEnv, _extract_answer


def test_logic_quiz_is_registered():
    assert "logic_quiz" in ENVIRONMENT_REGISTRY


def test_sample_tasks_reads_json():
    env = LogicQuizEnv(PolliusConfig(data_dir="data"))
    tasks = env.sample_tasks(2, np.random.default_rng(0))
    by_id = {t.problem_id: t for t in tasks}
    assert by_id["parity"].extra["answer"] == "odd"
    assert by_id["next_num"].extra["answer"] == "10"
    assert all(t.env == "logic_quiz" for t in tasks)


def test_extract_answer_picks_last_answer_line():
    assert _extract_answer("blah\nAnswer: Odd") == "odd"
    assert _extract_answer("Answer: even\nthen Answer: odd") == "odd"
    assert _extract_answer("no marker here\n10") == "10"


def test_reward_matches_answer():
    env = LogicQuizEnv(PolliusConfig(data_dir="data"))
    task = [t for t in env.sample_tasks(2, np.random.default_rng(0)) if t.problem_id == "parity"][0]
    assert env.reward(task, "I think Answer: odd", PolliusConfig()) == 1.0
    assert env.reward(task, "Answer: even", PolliusConfig()) == 0.0
```

- [ ] **Step 3: Run test to verify it fails**

Run: `python3 -m pytest tests/test_env_logic_quiz.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'pollius.environments.logic_quiz'`

- [ ] **Step 4: Write the implementation**

Create `pollius/environments/logic_quiz.py`:

```python
"""logic_quiz environment -- Q/A tasks scored by exact answer match.

Layout: data_dir/logic_quiz/<problem>/task.json = {"prompt": ..., "answer": ...}.
The reward extracts the last `Answer: <x>` line (or the last non-empty line) and
compares it, case-insensitively, to the stored answer.
"""

from __future__ import annotations

import json
import os
import re

from pollius.environments.base import Task, register_environment


def _extract_answer(text: str) -> str:
    matches = re.findall(r"answer\s*[:=]\s*(.+)", text, flags=re.IGNORECASE)
    if matches:
        return matches[-1].strip().lower()
    lines = [ln for ln in text.strip().splitlines() if ln.strip()]
    return lines[-1].strip().lower() if lines else ""


@register_environment("logic_quiz")
class LogicQuizEnv:
    name = "logic_quiz"

    def __init__(self, config) -> None:
        self.config = config
        self.root = os.path.join(config.data_dir, "logic_quiz")

    def _problems(self):
        out = []
        if not os.path.isdir(self.root):
            return out
        for name in sorted(os.listdir(self.root)):
            task_path = os.path.join(self.root, name, "task.json")
            if not os.path.isfile(task_path):
                continue
            with open(task_path) as f:
                obj = json.load(f)
            out.append((name, obj["prompt"], str(obj["answer"])))
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
            Task("logic_quiz", probs[i][0], probs[i][1], {"answer": probs[i][2]})
            for i in idx
        ]

    def reward(self, task: Task, response_text: str, config) -> float:
        want = str(task.extra["answer"]).strip().lower()
        return 1.0 if _extract_answer(response_text) == want else 0.0
```

- [ ] **Step 5: Run test to verify it passes**

Run: `python3 -m pytest tests/test_env_logic_quiz.py -q`
Expected: PASS (4 passed)

- [ ] **Step 6: Commit**

```bash
git add pollius/environments/logic_quiz.py data/logic_quiz tests/test_env_logic_quiz.py
git commit -m "feat: add logic_quiz environment + example quizzes"
```

---

### Task 6: Env-dispatched reward helper + load_environments

**Files:**
- Create: `pollius/environments/dispatch.py`
- Modify: `pollius/environments/__init__.py`
- Test: `tests/test_env_dispatch.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_env_dispatch.py`:

```python
"""Tests for env dispatch. Run: python3 -m pytest tests/test_env_dispatch.py -q"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig
from pollius.environments.base import Task
from pollius.environments.dispatch import compute_rewards, load_environments


def test_load_environments_instantiates_by_name():
    envs = load_environments(("logic_quiz",), PolliusConfig(data_dir="data"))
    assert "logic_quiz" in envs
    assert envs["logic_quiz"].name == "logic_quiz"


def test_compute_rewards_dispatches_per_task_env():
    cfg = PolliusConfig(data_dir="data")
    envs = load_environments(("logic_quiz",), cfg)
    task = Task("logic_quiz", "parity", "q", {"answer": "odd"})
    # two samples for the same task: one correct, one wrong
    tasks = [task, task]
    responses = ["Answer: odd", "Answer: even"]
    rewards = compute_rewards(tasks, responses, envs, cfg)
    assert rewards == [1.0, 0.0]


def test_compute_rewards_raises_on_unknown_env():
    cfg = PolliusConfig(data_dir="data")
    envs = load_environments(("logic_quiz",), cfg)
    tasks = [Task("nope", "x", "q", {})]
    import pytest
    with pytest.raises(KeyError):
        compute_rewards(tasks, ["whatever"], envs, cfg)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest tests/test_env_dispatch.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'pollius.environments.dispatch'`

- [ ] **Step 3: Write the implementation**

Create `pollius/environments/dispatch.py`:

```python
"""Instantiate environments by name and score responses by their origin env.

`load_environments` turns config names into live env instances (importing the
env modules so their @register_environment decorators have run). `compute_rewards`
scores each (task, response) pair by dispatching to the env named on the task --
this is what lets one batch mix many task types.
"""

from __future__ import annotations

from typing import Dict, List

# Import side-effect: registers the shipped environments.
from pollius.environments import lean_proof as _lean_proof  # noqa: F401
from pollius.environments import logic_quiz as _logic_quiz  # noqa: F401
from pollius.environments.base import Task, get_environment


def load_environments(names, config) -> Dict[str, object]:
    """Instantiate each named environment. Returns {name: env_instance}."""
    return {name: get_environment(name)(config) for name in names}


def compute_rewards(
    tasks: List[Task],
    responses: List[str],
    envs: Dict[str, object],
    config,
) -> List[float]:
    """Score each response with the environment that produced its task.

    Raises KeyError if a task names an environment not in `envs` (fail fast on a
    misconfigured batch rather than silently scoring 0).
    """
    rewards = []
    for task, response in zip(tasks, responses):
        if task.env not in envs:
            raise KeyError(
                f"Task references env '{task.env}' not loaded. "
                f"Loaded: {sorted(envs)}"
            )
        rewards.append(float(envs[task.env].reward(task, response, config)))
    return rewards
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest tests/test_env_dispatch.py -q`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add pollius/environments/dispatch.py tests/test_env_dispatch.py
git commit -m "feat: add env-dispatched reward helper and loader"
```

---

### Task 7: Demo script + README + full-suite verification

**Files:**
- Create: `demo_environments.py`
- Modify: `README.md`
- Test: (run the whole suite)

- [ ] **Step 1: Write the demo script**

Create `demo_environments.py`:

```python
"""Demo: draw tasks from environments, score canned responses, report pass@k.

No model and no Lean needed -- logic_quiz scores by answer match, so this runs
anywhere and shows the Environment + dispatch + pass@k path end to end.

    python3 demo_environments.py
"""

from __future__ import annotations

import numpy as np

from pollius.config import PolliusConfig
from pollius.environments.dispatch import compute_rewards, load_environments
from pollius.metrics import pass_at_k


def main() -> None:
    cfg = PolliusConfig(data_dir="data")
    envs = load_environments(("logic_quiz",), cfg)
    env = envs["logic_quiz"]

    rng = np.random.default_rng(0)
    tasks = env.sample_tasks(2, rng)

    # Fake G=4 "model" responses per task: 3 correct, 1 wrong (stand-in for rollout).
    group_size = 4
    flat_tasks, responses, group_ids = [], [], []
    for gi, task in enumerate(tasks):
        correct = f"Answer: {task.extra['answer']}"
        cands = [correct, correct, correct, "Answer: definitely-wrong"]
        for c in cands:
            flat_tasks.append(task)
            responses.append(c)
            group_ids.append(gi)

    rewards = compute_rewards(flat_tasks, responses, envs, cfg)
    group_ids = np.array(group_ids)

    print(f"tasks: {[t.problem_id for t in tasks]}  group_size={group_size}")
    print(f"mean reward: {np.mean(rewards):.3f}")
    for k in cfg.pass_at_k_values:
        _, mean = pass_at_k(rewards, group_ids, k)
        print(f"pass@{k}: {mean:.3f}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the demo**

Run: `python3 demo_environments.py`
Expected output (3/4 correct per group → pass@1 = 0.75, pass@4 = 1.0):

```
tasks: ['next_num', 'parity']  group_size=4
mean reward: 0.750
pass@1: 0.750
pass@4: 1.000
```

(Task order may differ by RNG; the numbers are what matter.)

- [ ] **Step 3: Update the README**

In `README.md`, add this section after the existing "The three swappable boxes" table:

```markdown
## Environments (the 4th box)

A task type bundles *where questions come from* and *how answers are scored*:

| Env | File | Reward | Data |
|-----|------|--------|------|
| `lean_proof` | `pollius/environments/lean_proof.py` | real Lean4 verifier (`lake env lean`) | `data/lean_proof/<problem>/` |
| `logic_quiz` | `pollius/environments/logic_quiz.py` | exact answer match | `data/logic_quiz/<problem>/task.json` |

Rewards are dispatched per sample by the env that produced the task, so a batch
can mix task types. `pass@k` (`pollius/metrics.py`) is logged per problem-group.
Add a task type by writing one `@register_environment("name")` class.

```bash
python3 demo_environments.py     # env + dispatch + pass@k, no model/Lean needed
```

> `lean_proof` rewards need a real Lean toolchain: install elan/Lean and point
> `config.lean_project_dir` at a Lake project. Without `lake`, the verifier raises.
```

- [ ] **Step 4: Run the entire test suite**

Run: `python3 -m pytest tests/ -q`
Expected: PASS — all suites green (the original 12 sanity tests + the new environment/metrics/verifier tests, ~34 total). Confirm 0 failures.

- [ ] **Step 5: Commit**

```bash
git add demo_environments.py README.md
git commit -m "docs: add environments demo script and README section"
```

---

## Notes for the implementer

- **No torch in this plan.** The Environment library is model-agnostic. The torch
  training backend (TorchPolicyRollout, losses_torch, TorchTrainer) is a separate
  plan that consumes these environments — do not pull it in here.
- **Lean is not installed in this environment.** Every Lean-dependent test
  monkeypatches `subprocess`/`shutil`, so the suite is fully green without `lake`.
  Real end-to-end Lean verification is exercised only once a toolchain exists.
- **`Sample`/`RolloutBatch` text/meta fields** (spec §5.5) are intentionally
  deferred to the torch plan — nothing in phases 1–4 needs them, since dispatch
  operates on `Task` lists directly. (YAGNI.)
- Run `python3 -m pytest tests/ -q` after every task; keep the suite green.
```
