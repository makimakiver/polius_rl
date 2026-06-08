# Off-chain verifiers environment: `sort-list` — design

**Date:** 2026-06-08
**Status:** Approved (brainstorming)

## Summary

Build a self-contained, GPU-free off-chain RL environment in the `verifiers`
framework: a toy **list-sorting** task with a **deterministic rubric**, exposing
`load_environment()`, runnable via `uv run vf-eval`. The eval model is an
**open-weights model (Qwen2.5-7B-Instruct)** served through a **hosted
OpenAI-compatible endpoint** (e.g. Together) — chosen so the same model can be
used for later RL parameter tuning (a closed model like OpenAI cannot be tuned).

This is the MUST item 1-A (off-chain environment / verifiers interface) for the
demo. It is an isolated Python sub-project under `environments/`; it does not
touch the existing Next.js / Move code.

## Goals

- A toy task whose reward is **deterministic** (exact-match, plus a difflib
  partial-credit metric) — no model variance in scoring.
- A module exposing `load_environment(...) -> vf.SingleTurnEnv`.
- Local verification two ways: a **model-free `pytest`** (proves rubric
  determinism, no API key/GPU) and `uv run vf-eval` against the hosted open model.
- Open-weights model end-to-end so eval now and tuning later use the same family.

## Non-goals (YAGNI)

- No training/RL loop, no GRPO, no GPU, no on-chain integration in this slice.
- No multi-turn env, no tools, no custom parser beyond extracting integers.
- We do not host the model ourselves — a hosted OpenAI-compatible provider serves
  Qwen; local Ollama is an optional fallback, not the primary path.

## Layout

```
environments/
├── pyproject.toml          # uv project: depends on `verifiers` (+ pytest, datasets)
├── README.md               # how to run vf-eval + pytest
├── .env.example            # documents the API key + base url vars (gitignored .env)
├── sort-list/
│   ├── pyproject.toml      # installable env package, name = "sort-list"
│   └── sort_list.py        # load_environment + rubric
└── tests/
    └── test_rubric.py      # model-free determinism tests
```

`environments/` is a `uv`-managed Python project (Python 3.13 available). The env
package `sort-list/` is installed into that environment via `vf-install`, then run
with `vf-eval sort-list`.

## The environment — `environments/sort-list/sort_list.py`

`load_environment(num_examples: int = 20, list_len: int = 6, seed: int = 0,
low: int = 0, high: int = 99) -> vf.SingleTurnEnv`

- **Dataset (deterministic):** build with `random.Random(seed)` so the dataset is
  fixed across runs. Each example: a shuffled list of `list_len` integers in
  `[low, high]`. Columns:
  - `question`: `"Sort this list of integers in ascending order. Return ONLY the
    sorted integers, space-separated, nothing else.\n\n<space-separated nums>"`
  - `answer`: the `sorted()` list as a space-separated string.
  Returned as a Hugging Face `datasets.Dataset`.
- **System prompt:** instructs the model to output only the sorted integers,
  space-separated, with no prose.
- **Parser:** `vf.Parser()` (the final assistant message content is the answer).
- **Rubric:** `vf.Rubric(funcs=[exact_match, partial_ratio], weights=[1.0, 0.0])`.
- Returns `vf.SingleTurnEnv(dataset=dataset, system_prompt=SYSTEM_PROMPT,
  parser=parser, rubric=rubric)`.

### Reward functions (deterministic)

A shared helper parses the integer sequence from text:
```python
import re
def _parse_ints(text: str) -> list[int]:
    return [int(x) for x in re.findall(r"-?\d+", text)]
```

- `exact_match(completion, answer, **kwargs) -> float` — `1.0` if
  `_parse_ints(completion[-1]["content"]) == _parse_ints(answer)` else `0.0`.
- `partial_ratio(completion, answer, **kwargs) -> float` — a continuous
  `difflib.SequenceMatcher` ratio between the parsed sequences (as strings),
  `0.0..1.0`. Weight `0.0` → reported as a metric (training-signal gradient
  visibility), not part of the weighted reward; the weight is adjustable later.

Both are pure/deterministic: same inputs → same score, independent of the model.

## Model / serving (open-weights, GPU-free)

- Model: **`Qwen2.5-7B-Instruct`** via a hosted **OpenAI-compatible** endpoint.
- `vf-eval` points at the provider with `-b`/`-k`:
  - `-m` the provider's Qwen id (e.g. Together: `Qwen/Qwen2.5-7B-Instruct-Turbo`),
  - `-b` the base URL (e.g. `https://api.together.xyz/v1`),
  - `-k` the **name** of the env var holding the key (e.g. `TOGETHER_API_KEY`).
- The provider is configurable; Together is the documented default example.
  Key + base url live in `environments/.env` (gitignored); `.env.example` documents
  the variable names.

## Verification

No assumptions about a GPU. Two layers:

1. **Model-free pytest** (`environments/tests/test_rubric.py`), the determinism gate:
   - correct sorted output → `exact_match == 1.0`
   - wrong/unsorted output → `exact_match == 0.0`
   - a partially-correct sequence → `0.0 < partial_ratio < 1.0`
   - `load_environment()` returns a `vf.SingleTurnEnv` with `len(dataset) == num_examples`
   Run: `cd environments && uv run pytest -q`. Passes with no API key, no GPU.

2. **`vf-eval` rollout** (requires the provider key set):
   `cd environments && uv run vf-install ./sort-list && \
    uv run vf-eval sort-list -m Qwen/Qwen2.5-7B-Instruct-Turbo \
      -b https://api.together.xyz/v1 -k TOGETHER_API_KEY -n 5`
   Expected: rollouts complete and per-example rewards are reported; correct sorts
   score `1.0`. If the key is unset, this step is skipped (pytest still passes).

## Data flow

`vf-eval sort-list` → loads the deterministic dataset → sends each `question`
(with system prompt) to the hosted Qwen endpoint → parser takes the final message
→ rubric scores `exact_match` (+`partial_ratio` metric) → aggregate reward report.

## Error handling

- `_parse_ints` on empty/garbled output → `[]` → `exact_match` `0.0`,
  `partial_ratio` `0.0` (no crash).
- `vf-eval` with a missing/invalid key → provider auth error surfaced by verifiers;
  documented in the README (set `TOGETHER_API_KEY`). The pytest path is unaffected.

## Files

- New: `environments/pyproject.toml`, `environments/README.md`,
  `environments/.env.example`, `environments/sort-list/pyproject.toml`,
  `environments/sort-list/sort_list.py`, `environments/tests/test_rubric.py`.
- Edit: `.gitignore` (ignore `environments/.env`, `__pycache__/`, `.venv/`,
  `*.egg-info/`, verifiers eval output dir).

## Risks / notes

- `verifiers` evolves; pin a working version in `pyproject.toml` and confirm the
  exact `load_environment`/`Rubric`/reward-fn signatures + `vf-eval` flags against
  the installed version during implementation (adjust the thin adapter if needed).
- The repo is primarily Next.js + Move; this adds a Python toolchain under
  `environments/` only — kept isolated, no interaction with the web app.
- Provider model ids differ (Together vs OpenRouter vs Fireworks); the README lists
  the id per provider and the base url; defaults shown for Together.
- Reusing this exact env + open model for later RL tuning is the intended path
  (out of scope here, but the model choice is made with it in mind).
