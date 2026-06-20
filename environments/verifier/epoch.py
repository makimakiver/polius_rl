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


def _ints(text: str) -> list:
    return [int(x) for x in re.findall(r"-?\d+", text or "")]


def exact_match(generated: str, answer: str) -> float:
    return 1.0 if _ints(generated) == _ints(answer) else 0.0


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


def make_model_fn():
    """The sample OSS LLM attempt fn — real Qwen-0.5B when available, else stand-in."""
    from verifier import llm
    if llm.available():
        return lambda q: llm.generate_chat(DIRECT_SYSTEM, q, max_new_tokens=48)
    # stand-in: a deterministic imperfect baseline (sorts but drops the sign on negatives)
    def standin(q):
        nums = _ints(q)
        return " ".join(map(str, sorted(abs(x) for x in nums)))
    return standin
