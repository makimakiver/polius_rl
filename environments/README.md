# Pollius off-chain environments

## sort-list  *(dir: `sort_list/`)*

A toy `verifiers` environment: the model sorts a list of integers. Scoring is
deterministic — `exact_match` is the reward (weight 1.0); a difflib
`partial_ratio` similarity is logged as a metric only (weight 0.0).

### Setup

```bash
cd environments
uv sync --group dev
uv run vf-install sort-list -p .
```

(`vf-install` normalises the env id to `sort_list` and installs the package in
`environments/sort_list/`.)

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
