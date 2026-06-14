"""The trainer -- wires the three boxes into one training step and loops.

It owns nothing algorithmic: it looks the boxes up by name from the config and
moves tensors between them. That is the whole point of the decoupled design.
"""

from __future__ import annotations

from typing import List

import numpy as np

from pollius.advantage import get_advantage_fn
from pollius.config import PolliusConfig
from pollius.losses import get_policy_loss_fn
from pollius.reward import get_reward_fn
from pollius.rollout import Rollout
from pollius.types import LossMetrics, RolloutBatch


class PolliusTrainer:
    def __init__(self, config: PolliusConfig, rollout: Rollout) -> None:
        self.config = config
        self.rollout = rollout
        # resolve the swappable boxes once, up front (fail fast on bad names)
        self.reward_fn = get_reward_fn(config.reward_fn)
        self.advantage_fn = get_advantage_fn(config.adv_estimator)
        self.policy_loss_fn = get_policy_loss_fn(config.policy_loss)
        # separate stream so the mocked "current policy" differs from rollout
        self._rng = np.random.default_rng(config.seed + 1)

    # -- the mocked model ---------------------------------------------------
    def _current_log_probs(self, batch: RolloutBatch) -> np.ndarray:
        """Stand-in for re-scoring the responses under the current policy.

        A real trainer runs a forward pass here. We perturb the rollout
        log-probs slightly so the IS ratio is a realistic value near 1.0
        (and CISPO's clipping actually engages sometimes).
        """
        noise = self._rng.uniform(-0.15, 0.15, size=batch.old_log_probs.shape)
        return batch.old_log_probs + noise

    def _optimizer_step(self, loss: float) -> None:
        """No real parameters in the skeleton, so this is a logged no-op.

        In a real trainer: ``loss.backward(); optimizer.step()`` on the policy.
        """
        # intentionally empty -- see docstring

    # -- one training step --------------------------------------------------
    def train_step(self) -> LossMetrics:
        cfg = self.config

        # 1. rollout: sample G responses per prompt
        batch = self.rollout.generate(cfg.num_prompts_per_step, cfg.group_size)

        # 2. reward: one scalar per sample (null stub -> 0.0)
        rewards = np.array(
            [self.reward_fn(s, cfg) for s in batch.samples()], dtype=np.float64
        )
        batch.rewards = rewards

        # 3. advantage: GRPO group-norm, broadcast to tokens
        batch.advantages = self.advantage_fn(
            rewards, batch.group_ids, batch.response_mask, cfg
        )

        # 4. policy loss: CISPO over (old_log_probs, current_log_probs, advantages)
        log_probs = self._current_log_probs(batch)
        loss, metrics = self.policy_loss_fn(
            batch.old_log_probs, log_probs, batch.advantages, batch.response_mask, cfg
        )

        # 5. update
        self._optimizer_step(loss)
        return metrics

    # -- the loop -----------------------------------------------------------
    def fit(self) -> List[LossMetrics]:
        history: List[LossMetrics] = []
        for step in range(self.config.num_steps):
            metrics = self.train_step()
            history.append(metrics)
            print(
                f"[step {step:>3}] loss={metrics.loss:+.6f} "
                f"approx_kl={metrics.approx_kl:+.4f} "
                f"clipfrac={metrics.clipfrac:.3f} "
                f"mean_ratio={metrics.mean_ratio:.3f}"
            )
        return history
