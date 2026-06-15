"""Driver: real local-LLM training with Qwen on environment rewards.

    python3 train_pollius_torch.py --steps 1 --group-size 2 --max-new-tokens 32

Downloads Qwen/Qwen2.5-0.5B-Instruct on first run (~1GB) and trains on MPS/CPU.
Uses the logic_quiz environment by default (no Lean toolchain needed).

Pass --compare to greedy-eval every task BEFORE training and again AFTER, then
print a side-by-side of the proofs plus a verified-count summary:

    python3 train_pollius_torch.py --environments lean_proof --steps 20 --compare
"""

from __future__ import annotations

import argparse

import torch

from pollius.core import PolliusConfig
from pollius.environments.dispatch import load_environments
from pollius.backends.torch_llm import TORCH_POLICY_LOSS_REGISTRY
from pollius.algorithms import ADVANTAGE_REGISTRY


# ----------------------------------------------------------------------------
# Before/after comparison (greedy, deterministic -- training itself samples)
# ----------------------------------------------------------------------------
def greedy_proof(policy, prompt_text: str, max_new_tokens: int) -> str:
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


def evaluate(policy, envs, cfg):
    """Greedy-eval every task across all envs -> list of result rows."""
    rows = []
    for name, env in envs.items():
        for task in env.load_tasks():
            proof = greedy_proof(policy, task.prompt, cfg.max_new_tokens).strip()
            try:
                verified = bool(env.reward(task, proof, cfg))
            except RuntimeError as e:  # no Lean toolchain on PATH
                verified = None
                evaluate._lean_msg = str(e).splitlines()[0]
            rows.append(
                {"env": name, "problem_id": task.problem_id,
                 "proof": proof, "verified": verified}
            )
    return rows


def _mark(verified):
    return {True: "PASS", False: "FAIL", None: "skip"}[verified]


def report(before, after, cfg) -> None:
    print("\n" + "=" * 72)
    print("BEFORE  vs  AFTER")
    print("=" * 72)
    for b, a in zip(before, after):
        print(f"\n### {b['env']}/{b['problem_id']}")
        print(f"  BEFORE [{_mark(b['verified'])}]: {b['proof']!r}")
        print(f"  AFTER  [{_mark(a['verified'])}]: {a['proof']!r}")

    print("\n" + "=" * 72)
    if any(r["verified"] is None for r in before):
        msg = getattr(evaluate, "_lean_msg", "Lean toolchain not found")
        print(f"verification SKIPPED (no Lean toolchain): {msg}")
    else:
        n = len(before)
        passed = lambda rows: sum(1 for r in rows if r["verified"] is True)
        print(f"verified  BEFORE: {passed(before)}/{n}   AFTER: {passed(after)}/{n}")
    print("=" * 72)


def main() -> None:
    p = argparse.ArgumentParser(description="Real Qwen RL training on env rewards.")
    p.add_argument("--model", default=PolliusConfig.model_name)
    p.add_argument("--environments", default="logic_quiz")
    p.add_argument("--steps", type=int, default=1)
    p.add_argument("--num-prompts", type=int, default=2)
    p.add_argument("--group-size", type=int, default=2)
    p.add_argument("--max-new-tokens", type=int, default=32)
    p.add_argument("--lr", type=float, default=1e-5)
    p.add_argument("--policy-loss", default="cispo", choices=sorted(TORCH_POLICY_LOSS_REGISTRY))
    p.add_argument("--adv-estimator", default="grpo", choices=sorted(ADVANTAGE_REGISTRY))
    p.add_argument("--device", default="auto")
    p.add_argument("--compare", action="store_true",
                   help="greedy-eval every task before and after training, print a diff")
    args = p.parse_args()

    cfg = PolliusConfig(
        model_name=args.model,
        environments=tuple(args.environments.split(",")),
        num_steps=args.steps,
        num_prompts_per_step=args.num_prompts,
        group_size=args.group_size,
        max_new_tokens=args.max_new_tokens,
        lr=args.lr,
        policy_loss=args.policy_loss,
        adv_estimator=args.adv_estimator,
        device=args.device,
    )

    from pollius.backends.torch_llm import TorchPolicy
    from pollius.backends.torch_llm import TorchTrainer

    print(f"model={cfg.model_name}  envs={cfg.environments}  loss={cfg.policy_loss}")
    policy = TorchPolicy(cfg)
    print(f"device={policy.device}")
    envs = load_environments(cfg.environments, cfg)

    before = None
    if args.compare:
        print("== evaluating BASE model (before training) ...")
        before = evaluate(policy, envs, cfg)

    TorchTrainer(cfg, policy, envs).fit()

    if args.compare:
        print("\n== evaluating TRAINED model (after training) ...")
        after = evaluate(policy, envs, cfg)
        report(before, after, cfg)


if __name__ == "__main__":
    main()
