# Verifiers `sort-list` Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained, GPU-free `verifiers` environment `sort-list` (toy list-sorting task) with a deterministic rubric, runnable via `uv run vf-eval` against an open-weights model (Qwen2.5-7B-Instruct) on a hosted OpenAI-compatible endpoint.

**Architecture:** A `uv`-managed Python project under `environments/` with `verifiers` installed. An installable env package `environments/sort-list/` exposes `load_environment() -> vf.SingleTurnEnv` over a deterministic seeded dataset; reward functions (`exact_match`, `partial_ratio`) score deterministically. Verified by a model-free `pytest` (determinism gate) and `vf-eval` rollouts.

**Tech Stack:** Python 3.13, `uv` 0.10.9, `verifiers` (pinned at install), `datasets`, `pytest`. Eval model: Qwen2.5-7B-Instruct via a hosted OpenAI-compatible provider (Together default).

---

## Why TDD here

The reward functions are pure (regex + difflib over plain data) — ideal for test-first. The model-free `pytest` is also the spec's determinism gate. `vf-eval` (real model) is an integration check gated on a provider API key. This repo has no Python test runner yet; this plan introduces `pytest` under `environments/` only.

## File structure

- `environments/pyproject.toml` — uv project; declares `verifiers`, `datasets`, dev `pytest`.
- `environments/.gitignore` additions (or repo `.gitignore`) — ignore `.venv/`, `.env`, `__pycache__/`, `*.egg-info/`, `outputs/`, `.pytest_cache/`.
- `environments/sort-list/pyproject.toml` — installable env package (`name = "sort-list"`).
- `environments/sort-list/sort_list.py` — `load_environment` + rubric.
- `environments/tests/test_rubric.py` — model-free determinism tests.
- `environments/.env.example` — documents provider key + base url vars.
- `environments/README.md` — run instructions.

---

## Task 1: uv project + install verifiers + confirm API

**Files:** Create `environments/pyproject.toml`; modify repo `.gitignore`.

- [ ] **Step 1: Create the uv project file `environments/pyproject.toml`**

```toml
[project]
name = "pollius-environments"
version = "0.0.0"
description = "Pollius off-chain RL environments (verifiers)"
requires-python = ">=3.11"
dependencies = []

[dependency-groups]
dev = ["pytest>=8"]
```

- [ ] **Step 2: Add Python ignores to the repo `.gitignore`**

Append to `/Users/makimakiver/pollius_rl/.gitignore`:

```
# Python / verifiers environments
environments/.venv/
environments/.env
environments/**/__pycache__/
environments/**/*.egg-info/
environments/outputs/
environments/.pytest_cache/
```

- [ ] **Step 3: Install verifiers + datasets and confirm the toolchain**

Run:
```bash
cd /Users/makimakiver/pollius_rl/environments
uv add verifiers datasets
uv sync --group dev
uv run python -c "import verifiers as vf; print('VERIFIERS', vf.__version__); print('SingleTurnEnv', hasattr(vf,'SingleTurnEnv'), '| Rubric', hasattr(vf,'Rubric'), '| Parser', hasattr(vf,'Parser'))"
uv run vf-eval --help | head -30
uv run vf-install --help | head -15
```
Expected: prints a `verifiers` version; `SingleTurnEnv True | Rubric True | Parser True`; `vf-eval --help` lists flags including a model flag (`-m/--model`), a base-url flag, an api-key flag, and a num-examples flag (`-n`).

**If `uv add verifiers` fails on macOS due to GPU-only deps** (e.g. `vllm`/`flash-attn`): retry installing only the eval-capable base — `uv add "verifiers" --no-build-isolation` is NOT the fix; instead check `uv run python -c "import verifiers"` after `uv add verifiers datasets openai`; if a heavy extra is the default, install the base package without training extras (consult the verifiers pyproject/extras). Report findings as DONE_WITH_CONCERNS if you had to deviate.

**If `vf-eval`/`vf-install` do not exist** (only a `prime` CLI is present): STOP and report BLOCKED with the `--help` output — the spec requires the `vf-*` CLI.

Record in your report: the resolved `verifiers` version, the three `hasattr` booleans, and the exact `vf-eval` flags for model / base-url / api-key / num-examples (later tasks depend on them).

- [ ] **Step 4: Commit** (commit the lockfile; `.venv` is gitignored)

```bash
cd /Users/makimakiver/pollius_rl
git add environments/pyproject.toml environments/uv.lock .gitignore
git commit -m "chore: set up environments/ uv project with verifiers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Rubric reward functions (TDD)

**Files:** Create `environments/tests/test_rubric.py`, `environments/sort-list/sort_list.py`, `environments/sort-list/pyproject.toml`.

- [ ] **Step 1: Write the failing tests**

Create `environments/tests/test_rubric.py`:

```python
from pathlib import Path
import sys

# import the single-module env package directly from ../sort-list/
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sort-list"))

from sort_list import _parse_ints, exact_match, partial_ratio  # noqa: E402


def _completion(text: str):
    return [{"role": "assistant", "content": text}]


def test_parse_ints():
    assert _parse_ints("3 1 2") == [3, 1, 2]
    assert _parse_ints("") == []
    assert _parse_ints("sorted: -2 0 5") == [-2, 0, 5]


def test_exact_match_correct():
    assert exact_match(_completion("1 2 3"), "1 2 3") == 1.0


def test_exact_match_wrong():
    assert exact_match(_completion("3 2 1"), "1 2 3") == 0.0


def test_exact_match_empty_output():
    assert exact_match(_completion(""), "1 2 3") == 0.0


def test_partial_ratio_between():
    r = partial_ratio(_completion("1 2 9"), "1 2 3")
    assert 0.0 < r < 1.0


def test_partial_ratio_perfect():
    assert partial_ratio(_completion("1 2 3"), "1 2 3") == 1.0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /Users/makimakiver/pollius_rl/environments && uv run pytest tests/test_rubric.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'sort_list'` (the module doesn't exist yet).

- [ ] **Step 3: Create the env package pyproject `environments/sort-list/pyproject.toml`**

```toml
[project]
name = "sort-list"
version = "0.1.0"
description = "Toy list-sorting verifiers environment"
requires-python = ">=3.11"
dependencies = ["verifiers", "datasets"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
include = ["sort_list.py"]
```

- [ ] **Step 4: Create `environments/sort-list/sort_list.py` with the rubric (load_environment added in Task 3)**

```python
"""sort-list: a toy verifiers environment.

The model is given a shuffled list of integers and must return them sorted in
ascending order, space-separated. Scoring is deterministic.
"""

import difflib
import re

SYSTEM_PROMPT = (
    "You sort lists of integers. Given a list, reply with ONLY the integers "
    "sorted in ascending order, space-separated, and nothing else."
)


def _parse_ints(text: str) -> list[int]:
    return [int(x) for x in re.findall(r"-?\d+", text or "")]


def exact_match(completion, answer, **kwargs) -> float:
    """1.0 iff the model's integer sequence equals the sorted answer, else 0.0."""
    got = _parse_ints(completion[-1]["content"])
    want = _parse_ints(answer)
    return 1.0 if got == want else 0.0


def partial_ratio(completion, answer, **kwargs) -> float:
    """Continuous difflib similarity (0..1) between the sequences — metric only."""
    got = _parse_ints(completion[-1]["content"])
    want = _parse_ints(answer)
    if not want:
        return 0.0
    a = " ".join(map(str, got))
    b = " ".join(map(str, want))
    return difflib.SequenceMatcher(None, a, b).ratio()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /Users/makimakiver/pollius_rl/environments && uv run pytest tests/test_rubric.py -q`
Expected: PASS (6 passed).

- [ ] **Step 6: Commit**

```bash
cd /Users/makimakiver/pollius_rl
git add environments/sort-list/pyproject.toml environments/sort-list/sort_list.py environments/tests/test_rubric.py
git commit -m "feat: add sort-list rubric (deterministic exact-match + difflib)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `load_environment` + deterministic dataset (TDD)

**Files:** Modify `environments/sort-list/sort_list.py`, `environments/tests/test_rubric.py`.

- [ ] **Step 1: Add the failing env tests**

Append to `environments/tests/test_rubric.py`:

```python
def test_load_environment_dataset_len():
    from sort_list import load_environment
    env = load_environment(num_examples=5, list_len=4, seed=0)
    assert len(env.dataset) == 5


def test_dataset_answers_are_sorted_and_deterministic():
    from sort_list import load_environment, _parse_ints
    a = load_environment(num_examples=5, seed=0)
    b = load_environment(num_examples=5, seed=0)
    # deterministic across calls
    assert list(a.dataset["answer"]) == list(b.dataset["answer"])
    # each answer is the ascending sort of the question's integers
    for row in a.dataset:
        q_nums = _parse_ints(row["question"])
        assert _parse_ints(row["answer"]) == sorted(q_nums)
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd /Users/makimakiver/pollius_rl/environments && uv run pytest tests/test_rubric.py -q`
Expected: FAIL — `ImportError: cannot import name 'load_environment'` (not defined yet).

- [ ] **Step 3: Add `_build_dataset` + `load_environment` to `sort_list.py`**

Add these imports at the top of `environments/sort-list/sort_list.py` (alongside the existing `difflib`/`re` imports):

```python
import random

import verifiers as vf
from datasets import Dataset
```

Append to the end of `environments/sort-list/sort_list.py`:

```python
def _build_dataset(num_examples: int, list_len: int, seed: int, low: int, high: int) -> Dataset:
    rng = random.Random(seed)
    rows = []
    for _ in range(num_examples):
        nums = [rng.randint(low, high) for _ in range(list_len)]
        question = (
            "Sort this list of integers in ascending order. Return ONLY the "
            "sorted integers, space-separated, nothing else.\n\n"
            + " ".join(map(str, nums))
        )
        rows.append({"question": question, "answer": " ".join(map(str, sorted(nums)))})
    return Dataset.from_list(rows)


def load_environment(
    num_examples: int = 20,
    list_len: int = 6,
    seed: int = 0,
    low: int = 0,
    high: int = 99,
    **kwargs,
) -> vf.SingleTurnEnv:
    dataset = _build_dataset(num_examples, list_len, seed, low, high)
    parser = vf.Parser()
    rubric = vf.Rubric(funcs=[exact_match, partial_ratio], weights=[1.0, 0.0])
    return vf.SingleTurnEnv(
        dataset=dataset,
        system_prompt=SYSTEM_PROMPT,
        parser=parser,
        rubric=rubric,
    )
```

NOTE (verifiers API): the calls `vf.Parser()`, `vf.Rubric(funcs=..., weights=...)`, and `vf.SingleTurnEnv(dataset=, system_prompt=, parser=, rubric=)` follow the documented API. If the version installed in Task 1 differs (e.g. `Rubric` rejects `weights`, or `SingleTurnEnv` uses a different dataset/parser kwarg, or `env.dataset` is named differently), adjust ONLY the thin adapter calls to match the installed signatures — keep the behavior (deterministic dataset, the two reward funcs, exact-match weighted 1.0) identical. Use the `vf-eval --help` / introspection captured in Task 1.

- [ ] **Step 4: Run to verify all tests pass**

Run: `cd /Users/makimakiver/pollius_rl/environments && uv run pytest tests/test_rubric.py -q`
Expected: PASS (8 passed).

- [ ] **Step 5: Commit**

```bash
cd /Users/makimakiver/pollius_rl
git add environments/sort-list/sort_list.py environments/tests/test_rubric.py
git commit -m "feat: add sort-list load_environment + deterministic dataset

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Install the env, docs, and `vf-eval` smoke run

**Files:** Create `environments/.env.example`, `environments/README.md`. Run `vf-install` + `vf-eval`.

- [ ] **Step 1: Create `environments/.env.example`**

```
# Hosted OpenAI-compatible provider for vf-eval rollouts (GPU-free).
# Copy to environments/.env (gitignored) and fill in. Example: Together.
#   model id:  Qwen/Qwen2.5-7B-Instruct-Turbo
#   base url:  https://api.together.xyz/v1
TOGETHER_API_KEY=
```

- [ ] **Step 2: Create `environments/README.md`**

````markdown
# Pollius off-chain environments

## sort-list

A toy `verifiers` environment: the model sorts a list of integers; scoring is
deterministic (exact match, with a difflib partial-credit metric).

### Setup

```bash
cd environments
uv sync --group dev
uv run vf-install ./sort-list
```

### Determinism check (no model, no API key, no GPU)

```bash
uv run pytest -q
```

### Evaluate with an open model (GPU-free, hosted OpenAI-compatible)

Set a provider key, then run `vf-eval`. Example with Together + Qwen2.5-7B:

```bash
export TOGETHER_API_KEY=...        # or put it in environments/.env
uv run vf-eval sort-list \
  -m Qwen/Qwen2.5-7B-Instruct-Turbo \
  -b https://api.together.xyz/v1 \
  -k TOGETHER_API_KEY \
  -n 5
```

The same open-weights model is intended for later RL parameter tuning.

Other providers: pass the provider's Qwen2.5-7B id via `-m`, its base url via
`-b`, and the env-var name holding the key via `-k` (e.g. OpenRouter:
`-m qwen/qwen-2.5-7b-instruct -b https://openrouter.ai/api/v1 -k OPENROUTER_API_KEY`).
````

(If Task 1 found the `vf-eval` model/base/key flags use different short names, use the actual flag names here and in Step 4.)

- [ ] **Step 3: Install the env package**

Run:
```bash
cd /Users/makimakiver/pollius_rl/environments
uv run vf-install ./sort-list
uv run python -c "import sort_list; print('INSTALLED', hasattr(sort_list, 'load_environment'))"
```
Expected: install succeeds; prints `INSTALLED True`.

- [ ] **Step 4: `vf-eval` smoke run (only if a provider key is available)**

If `TOGETHER_API_KEY` (or another provider key) is set in the environment:
```bash
cd /Users/makimakiver/pollius_rl/environments
uv run vf-eval sort-list -m Qwen/Qwen2.5-7B-Instruct-Turbo -b https://api.together.xyz/v1 -k TOGETHER_API_KEY -n 5
```
Expected: rollouts complete; a reward summary prints; correctly-sorted outputs score `1.0` on `exact_match`.

If NO provider key is available, SKIP this step and note it in your report — the determinism gate (`uv run pytest -q`, Task 3) already proves the rubric works without a model. Do not hardcode or invent a key.

- [ ] **Step 5: Final determinism check + commit**

```bash
cd /Users/makimakiver/pollius_rl/environments && uv run pytest -q
cd /Users/makimakiver/pollius_rl
git add environments/.env.example environments/README.md
git commit -m "docs: sort-list env README + .env.example; vf-install verified

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
Expected: `pytest` passes; commit lands. (If `vf-install` updated `uv.lock` or added an egg-info that isn't ignored, include only intended files; `*.egg-info/` is gitignored from Task 1.)

---

## Self-review notes

- **Spec coverage:** uv project + verifiers (T1) ✓; deterministic seeded dataset + `load_environment -> vf.SingleTurnEnv` (T3) ✓; deterministic rubric `exact_match` (weight 1.0) + `partial_ratio` difflib metric (weight 0.0) (T2) ✓; model-free pytest determinism gate (T2/T3) ✓; `vf-install` + `vf-eval` with open model via hosted OpenAI-compatible endpoint, GPU-free (T4) ✓; `.env.example` + README + `.gitignore` (T1/T4) ✓; isolation under `environments/` ✓.
- **Placeholder scan:** every code step is complete; the only deferred element is the optional key-gated `vf-eval` run (explicitly skippable, not a placeholder).
- **Naming consistency:** `_parse_ints`/`exact_match`/`partial_ratio` defined in T2 are imported in T2/T3 tests and used by `load_environment` in T3; the env id `sort-list` (package) ↔ module `sort_list` (import) is consistent across pyproject, tests (sys.path), `vf-install ./sort-list`, and `vf-eval sort-list`; dataset columns `question`/`answer` are produced in `_build_dataset` and asserted in T3 tests.
- **API-uncertainty allowance:** T1 captures the live verifiers version + signatures + `vf-eval` flags; T3 explicitly permits adapting only the thin `vf.*` adapter calls (not the behavior) if the installed version differs. This is faithful-to-an-evolving-dependency, not a vague placeholder.
```
