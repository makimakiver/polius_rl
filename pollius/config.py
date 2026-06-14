"""The single config object that wires the framework together.

The three string fields (`reward_fn`, `adv_estimator`, `policy_loss`) are the
names looked up in the registries -- change them to swap algorithms without
touching the trainer.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PolliusConfig:
    # --- which boxes to use (registry names) -------------------------------
    reward_fn: str = "null"        # see pollius/reward.py
    adv_estimator: str = "grpo"    # see pollius/advantage.py
    policy_loss: str = "cispo"     # see pollius/losses.py

    # --- rollout / batch shape --------------------------------------------
    num_prompts_per_step: int = 4
    group_size: int = 8            # G: samples per prompt (GRPO/CISPO need G > 1)
    prompt_length: int = 8         # P
    response_length: int = 16      # R
    vocab_size: int = 32000

    # --- CISPO clipping ----------------------------------------------------
    clip_ratio_low: float = 0.2    # ratio clipped to [1 - low, 1 + high]
    clip_ratio_high: float = 0.2

    # --- GRPO advantage ----------------------------------------------------
    grpo_std_norm: bool = True     # divide by group std (vs. mean-subtract only)
    adv_eps: float = 1e-6

    # --- loss aggregation / optimization ----------------------------------
    loss_agg_mode: str = "token-mean"  # how per-token losses collapse to a scalar
    lr: float = 1e-6                    # recorded only; no real params in skeleton

    # --- training loop -----------------------------------------------------
    num_steps: int = 5
    seed: int = 0

    def __post_init__(self) -> None:
        if self.group_size < 2:
            raise ValueError(
                "group_size must be >= 2 for group-based advantages "
                f"(GRPO/CISPO); got {self.group_size}"
            )
