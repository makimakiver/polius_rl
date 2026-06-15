"""Before/after eval: have the LLM solve the Lean problems, print the proofs,
and compare the BASE model against the SAME model after RL training.

Flow:
  1. load model (TorchPolicy)
  2. eval every lean_proof task with greedy decoding  -> "BEFORE" proofs
  3. train for --steps RL steps (TorchTrainer.fit, in place)
  4. eval again with the trained weights              -> "AFTER" proofs
  5. print a side-by-side, plus a verified-count summary

Greedy decoding is used for eval so the before/after comparison is deterministic
(training itself still samples). Reward = the real Lean verifier (needs `lake`);
if the toolchain is missing we still print the proofs and skip the pass/fail.

    python eval_lean_compare.py --model /path/to/qwen-0.5b --steps 20
"""

from __future__ import annotations

import argparse

import numpy as np
import torch

from pollius.core import PolliusConfig
from pollius.environments.dispatch import load_environments
from pollius.backends.torch_llm import TorchPolicy, TorchTrainer


def greedy_proof(policy: TorchPolicy, prompt_text: str, max_new_tokens: int) -> str:
    """Deterministic single completion for `prompt_text` (no sampling)."""
    messages = [{"role": "user", "content": prompt_text}]
    enc = policy.tokenizer.apply_chat_template(
        messages, add_generation_prompt=True, return_tensors="pt", return_dict=True
    )
    ids = enc["input_ids"].to(policy.device)
    attention_mask = enc["attention_mask"].to(policy.device)
    prompt_len = ids.shape[1]
    with torch.no_grad():
        out = policy.model.generate(
            ids,
            attention_mask=attention_mask,
            do_sample=False,
            max_new_tokens=max_new_tokens,
            pad_token_id=policy.tokenizer.pad_token_id,
        )
    response_ids = out[:, prompt_len:]
    return policy.tokenizer.batch_decode(response_ids, skip_special_tokens=True)[0]


def evaluate(policy: TorchPolicy, env, tasks, cfg):
    """Return [{problem_id, proof, verified}] for each task (greedy)."""
    rows = []
    for task in tasks:
        proof = greedy_proof(policy, task.prompt, cfg.max_new_tokens).strip()
        try:
            verified = bool(env.reward(task, proof, cfg))
        except RuntimeError as e:  # no Lean toolchain on PATH
            verified = None
            evaluate._lean_msg = str(e).splitlines()[0]
        rows.append({"problem_id": task.problem_id, "proof": proof, "verified": verified})
    return rows


def _mark(verified):
    return {True: "PASS", False: "FAIL", None: "skip"}[verified]


def main() -> None:
    p = argparse.ArgumentParser(description="Before/after Lean proof comparison.")
    p.add_argument("--model", default=PolliusConfig.model_name)
    p.add_argument("--environments", default="lean_proof")
    p.add_argument("--steps", type=int, default=20)
    p.add_argument("--num-prompts", type=int, default=2)
    p.add_argument("--group-size", type=int, default=4)
    p.add_argument("--max-new-tokens", type=int, default=32)
    p.add_argument("--lr", type=float, default=1e-5)
    p.add_argument("--device", default="auto")
    args = p.parse_args()

    cfg = PolliusConfig(
        model_name=args.model,
        environments=tuple(args.environments.split(",")),
        num_steps=args.steps,
        num_prompts_per_step=args.num_prompts,
        group_size=args.group_size,
        max_new_tokens=args.max_new_tokens,
        lr=args.lr,
        device=args.device,
    )

    print(f"== loading model: {cfg.model_name}")
    policy = TorchPolicy(cfg)
    print(f"== device: {policy.device}")

    envs = load_environments(cfg.environments, cfg)
    env = envs[cfg.environments[0]]
    tasks = env.load_tasks()  # all problems, deterministic order
    print(f"== {len(tasks)} task(s): {[t.problem_id for t in tasks]}\n")

    print("== evaluating BASE model (before training) ...")
    before = evaluate(policy, env, tasks, cfg)

    print(f"\n== training for {cfg.num_steps} steps ...")
    TorchTrainer(cfg, policy, envs).fit()

    print("\n== evaluating TRAINED model (after training) ...")
    after = evaluate(policy, env, tasks, cfg)

    # ---- side-by-side report ------------------------------------------------
    print("\n" + "=" * 72)
    print("BEFORE  vs  AFTER")
    print("=" * 72)
    for b, a in zip(before, after):
        print(f"\n### {b['problem_id']}")
        print(f"  BEFORE [{_mark(b['verified'])}]: {b['proof']!r}")
        print(f"  AFTER  [{_mark(a['verified'])}]: {a['proof']!r}")

    def passed(rows):
        return sum(1 for r in rows if r["verified"] is True)

    print("\n" + "=" * 72)
    if any(r["verified"] is None for r in before):
        msg = getattr(evaluate, "_lean_msg", "Lean toolchain not found")
        print(f"verification SKIPPED (no Lean toolchain): {msg}")
    else:
        n = len(tasks)
        print(f"verified  BEFORE: {passed(before)}/{n}   AFTER: {passed(after)}/{n}")
    print("=" * 72)


if __name__ == "__main__":
    main()
