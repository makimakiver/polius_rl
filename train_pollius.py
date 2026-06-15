"""Driver: run the pollius skeleton end-to-end on dummy data.

    python3 train_pollius.py                      # null reward -> loss is 0 (expected)
    python3 train_pollius.py --demo-random-reward # inject a signal -> watch it move
    python3 train_pollius.py --steps 10 --group-size 16

The --demo-random-reward flag registers a throwaway reward function *here*, in
the driver, so the real null stub in pollius/reward.py stays empty.
"""

from __future__ import annotations

import argparse

import numpy as np

from pollius import MockRollout, PolliusConfig, PolliusTrainer
from pollius.algorithms import ADVANTAGE_REGISTRY
from pollius.algorithms import POLICY_LOSS_REGISTRY
from pollius.backends.mock import register_reward


def _register_demo_reward() -> str:
    """A non-zero reward so GRPO advantages and the CISPO loss become non-trivial."""
    name = "demo_random"

    @register_reward(name)
    def demo_random_reward(sample, config=None) -> float:
        # deterministic-ish per sample so runs are reproducible given the seed
        rng = np.random.default_rng(abs(hash((sample.group_id, sample.index))) % (2**32))
        return float(rng.uniform(0.0, 1.0))

    return name


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the pollius RL skeleton.")
    parser.add_argument("--steps", type=int, default=5)
    parser.add_argument("--num-prompts", type=int, default=4)
    parser.add_argument("--group-size", type=int, default=8)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--adv-estimator",
        default=PolliusConfig.adv_estimator,
        choices=sorted(ADVANTAGE_REGISTRY),
        help="Advantage box to use (see pollius/advantage.py).",
    )
    parser.add_argument(
        "--policy-loss",
        default=PolliusConfig.policy_loss,
        choices=sorted(POLICY_LOSS_REGISTRY),
        help="Policy-loss box to use (see pollius/losses.py).",
    )
    parser.add_argument(
        "--demo-random-reward",
        action="store_true",
        help="Use a random reward (driver-only) instead of the null stub.",
    )
    args = parser.parse_args()

    config = PolliusConfig(
        adv_estimator=args.adv_estimator,
        policy_loss=args.policy_loss,
        num_steps=args.steps,
        num_prompts_per_step=args.num_prompts,
        group_size=args.group_size,
        seed=args.seed,
    )
    print(f"adv_estimator: {config.adv_estimator}   policy_loss: {config.policy_loss}")

    if args.demo_random_reward:
        config.reward_fn = _register_demo_reward()
        print("reward: demo_random (driver-injected)\n")
    else:
        print("reward: null stub -> all-zero (loss will be 0 by design)\n")

    trainer = PolliusTrainer(config, MockRollout(config))
    trainer.fit()


if __name__ == "__main__":
    main()
