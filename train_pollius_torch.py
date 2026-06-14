"""Driver: real local-LLM training with Qwen on environment rewards.

    python3 train_pollius_torch.py --steps 1 --group-size 2 --max-new-tokens 32

Downloads Qwen/Qwen2.5-0.5B-Instruct on first run (~1GB) and trains on MPS/CPU.
Uses the logic_quiz environment by default (no Lean toolchain needed).
"""

from __future__ import annotations

import argparse

from pollius.config import PolliusConfig
from pollius.environments.dispatch import load_environments
from pollius.losses_torch import TORCH_POLICY_LOSS_REGISTRY
from pollius.advantage import ADVANTAGE_REGISTRY


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

    from pollius.policy import TorchPolicy
    from pollius.trainer_torch import TorchTrainer

    print(f"model={cfg.model_name}  envs={cfg.environments}  loss={cfg.policy_loss}")
    policy = TorchPolicy(cfg)
    print(f"device={policy.device}")
    envs = load_environments(cfg.environments, cfg)
    TorchTrainer(cfg, policy, envs).fit()


if __name__ == "__main__":
    main()
