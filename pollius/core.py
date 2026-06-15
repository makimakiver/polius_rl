"""Core foundations: the config object and the data structures passed between boxes.

`PolliusConfig` holds every knob; its three string fields (`reward_fn`,
`adv_estimator`, `policy_loss`) are registry names that select algorithms without
touching the trainer. The dataclasses below are the only things the boxes exchange
-- plain numpy, so reward / advantage / loss evolve independently. Shapes use
B = num_prompts * group_size, P = prompt length, R = response length.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, Optional

import numpy as np


# ----------------------------------------------------------------------------
# Config
# ----------------------------------------------------------------------------
@dataclass
class PolliusConfig:
    # --- which boxes to use (registry names) -------------------------------
    reward_fn: str = "null"        # backends.mock reward registry
    adv_estimator: str = "grpo"    # algorithms advantage registry
    policy_loss: str = "cispo"     # algorithms / torch loss registry

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
    loss_agg_mode: str = "token-mean"
    lr: float = 1e-6

    # --- training loop -----------------------------------------------------
    num_steps: int = 5
    seed: int = 0

    # --- environments / data / eval ---------------------------------------
    environments: tuple = ("lean_proof",)
    data_dir: str = "data"
    lean_project_dir: str = "lean_project"  # must hold a lakefile + toolchain
    lean_timeout_s: float = 30.0
    reject_sorry: bool = True
    pass_at_k_values: tuple = (1, 4)

    # --- torch backend -----------------------------------------------------
    model_name: str = "Qwen/Qwen2.5-0.5B-Instruct"
    device: str = "auto"            # "auto" -> mps -> cuda -> cpu
    max_new_tokens: int = 64
    temperature: float = 1.0
    top_p: float = 1.0
    grad_clip: float = 1.0

    def __post_init__(self) -> None:
        if self.group_size < 2:
            raise ValueError(
                "group_size must be >= 2 for group-based advantages "
                f"(GRPO/CISPO); got {self.group_size}"
            )


# ----------------------------------------------------------------------------
# Data structures
# ----------------------------------------------------------------------------
@dataclass
class Sample:
    """One rollout sample -- the unit a reward function sees."""

    index: int
    group_id: int
    prompt_ids: np.ndarray     # (P,)
    response_ids: np.ndarray   # (R,)
    response_mask: np.ndarray  # (R,)


@dataclass
class RolloutBatch:
    """A batch of rollouts plus the fields later stages fill in."""

    prompt_ids: np.ndarray      # (B, P)
    response_ids: np.ndarray    # (B, R)
    response_mask: np.ndarray   # (B, R)
    old_log_probs: np.ndarray   # (B, R)
    group_ids: np.ndarray       # (B,)
    rewards: Optional[np.ndarray] = None      # (B,)
    advantages: Optional[np.ndarray] = None   # (B, R)

    @property
    def batch_size(self) -> int:
        return self.response_ids.shape[0]

    def samples(self) -> Iterator[Sample]:
        for i in range(self.batch_size):
            yield Sample(
                index=i,
                group_id=int(self.group_ids[i]),
                prompt_ids=self.prompt_ids[i],
                response_ids=self.response_ids[i],
                response_mask=self.response_mask[i],
            )


@dataclass
class LossMetrics:
    """Scalars a policy loss reports for logging."""

    loss: float
    clipfrac: float
    approx_kl: float
    mean_ratio: float

    def as_dict(self) -> dict:
        return {
            "loss": self.loss,
            "clipfrac": self.clipfrac,
            "approx_kl": self.approx_kl,
            "mean_ratio": self.mean_ratio,
        }
