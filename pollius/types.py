"""Data structures passed between the boxes.

Everything is a plain numpy array so the boxes connect through nothing more than
tensors -- exactly the decoupling that lets reward / advantage / loss evolve
independently. Shapes use B = num_prompts * group_size (the flattened batch),
P = prompt length, R = response length.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator, Optional

import numpy as np


@dataclass
class Sample:
    """One rollout sample -- the unit a reward function sees."""

    index: int                 # position in the flattened batch
    group_id: int              # which prompt-group this sample belongs to
    prompt_ids: np.ndarray     # (P,)
    response_ids: np.ndarray   # (R,)
    response_mask: np.ndarray  # (R,) 1.0 for real tokens, 0.0 for padding


@dataclass
class RolloutBatch:
    """A batch of rollouts plus the fields later stages fill in."""

    prompt_ids: np.ndarray      # (B, P)
    response_ids: np.ndarray    # (B, R)
    response_mask: np.ndarray   # (B, R)
    old_log_probs: np.ndarray   # (B, R) log-probs of the behavior (rollout) policy
    group_ids: np.ndarray       # (B,)   int group index per sample

    # filled by the trainer as the pipeline runs:
    rewards: Optional[np.ndarray] = None      # (B,)   one scalar per sample
    advantages: Optional[np.ndarray] = None   # (B, R) broadcast per token

    @property
    def batch_size(self) -> int:
        return self.response_ids.shape[0]

    def samples(self) -> Iterator[Sample]:
        """Iterate per-sample views for the reward function."""
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
    clipfrac: float       # fraction of tokens whose IS ratio hit the clip bound
    approx_kl: float       # mean(old_log_prob - log_prob) over valid tokens
    mean_ratio: float      # mean IS ratio over valid tokens

    def as_dict(self) -> dict:
        return {
            "loss": self.loss,
            "clipfrac": self.clipfrac,
            "approx_kl": self.approx_kl,
            "mean_ratio": self.mean_ratio,
        }
