"""Run ONE verification epoch of an RL environment on a sample OSS LLM.

A deployed environment is a dataset of tasks + a grader. To prove it is real and
trainable, we run a single epoch: the sample OSS LLM (Qwen-0.5B) attempts each
task, the environment's grader scores the output, and we report a baseline
mean reward + pass rate. That result is what the Nautilus enclave attests.

Dataset shape (verifiers-style): list of {"question": str, "answer": str}.
Default grader: exact-match on the parsed integer sequence (the sort-list env).
"""
import hashlib
import json
import re

DIRECT_SYSTEM = (
    "You sort integers. Given a list, reply with ONLY the integers sorted in "
    "ascending order, space-separated, and nothing else."
)
GENERIC_SYSTEM = (
    "Answer with ONLY the final answer — a single word or short phrase — and "
    "nothing else. No explanation, no punctuation."
)


def _ints(text: str) -> list:
    return [int(x) for x in re.findall(r"-?\d+", text or "")]


def exact_match(generated: str, answer: str) -> float:
    return 1.0 if _ints(generated) == _ints(answer) else 0.0


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", (s or "").lower()).strip()


def contains_match(generated: str, answer: str) -> float:
    """1.0 if the expected answer appears in the model's output (normalized)."""
    a = _norm(answer)
    return 1.0 if a and a in _norm(generated) else 0.0


# Grader registry — environments select one by name in their manifest.
GRADERS = {"exact_ints": exact_match, "contains": contains_match}


def default_dataset(n: int = 8, list_len: int = 6, seed: int = 0) -> list:
    import random
    rng = random.Random(seed)
    rows = []
    for _ in range(n):
        nums = [rng.randint(-9, 9) for _ in range(list_len)]
        rows.append({"question": "Sort ascending: " + " ".join(map(str, nums)),
                     "answer": " ".join(map(str, sorted(nums)))})
    return rows


def dataset_hash(dataset: list) -> bytes:
    canon = json.dumps(dataset, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(canon).digest()


def run_epoch(dataset: list, model_fn, grader=exact_match) -> dict:
    """One epoch: model_fn(question)->answer for each task, graded by `grader`.

    Returns {n_samples, mean_reward_bps, pass_bps, dataset_hash(bytes)}.
    """
    rewards = []
    for row in dataset:
        out = model_fn(row["question"])
        rewards.append(float(grader(out, row["answer"])))
    n = len(rewards)
    mean_reward_bps = int(round(10000 * (sum(rewards) / n))) if n else 0
    pass_bps = int(round(10000 * (sum(1 for r in rewards if r >= 1.0) / n))) if n else 0
    return {"n_samples": n, "mean_reward_bps": mean_reward_bps,
            "pass_bps": pass_bps, "dataset_hash": dataset_hash(dataset)}


def make_model_fn(system: str = DIRECT_SYSTEM, max_new_tokens: int = 48):
    """The sample OSS LLM attempt fn — real Qwen-0.5B when available, else stand-in.

    `system` selects the task framing (sorting vs a generic short-answer task).
    """
    from verifier import llm
    if llm.available():
        return lambda q: llm.generate_chat(system, q, max_new_tokens=max_new_tokens)
    # stand-in (no model): only the sort task has a deterministic baseline.
    if system == DIRECT_SYSTEM:
        return lambda q: " ".join(map(str, sorted(abs(x) for x in _ints(q))))
    return lambda q: ""  # generic tasks need a real model
