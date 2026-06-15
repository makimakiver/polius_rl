"""Mock backend -- the no-GPU teaching path: fake rollout, stub reward, no-op step.

`MockRollout` fabricates random tokens and behavior log-probs; the `null` reward
is the empty stub you fill in; `PolliusTrainer` wires rollout -> reward ->
advantage -> loss but its optimizer step is a logged no-op (no real parameters).
The real math (GRPO advantage, CISPO loss) is reused from pollius.algorithms.
"""

from __future__ import annotations

from typing import List, Protocol

import numpy as np

from pollius.algorithms import get_advantage_fn, get_policy_loss_fn
from pollius.core import LossMetrics, PolliusConfig, RolloutBatch, Sample
from pollius.registry import make_registry


# ----------------------------------------------------------------------------
# Rollout (mocked)
# ----------------------------------------------------------------------------
class Rollout(Protocol):
    """Anything that can produce a `RolloutBatch` for a set of prompts."""

    def generate(self, num_prompts: int, group_size: int) -> RolloutBatch: ...


class MockRollout:
    """Fabricates a `RolloutBatch` of random tokens and behavior log-probs."""

    def __init__(self, config) -> None:
        self.config = config
        self._rng = np.random.default_rng(config.seed)

    def generate(self, num_prompts: int, group_size: int) -> RolloutBatch:
        cfg = self.config
        batch = num_prompts * group_size
        p, r = cfg.prompt_length, cfg.response_length
        prompt_ids = self._rng.integers(0, cfg.vocab_size, size=(batch, p))
        response_ids = self._rng.integers(0, cfg.vocab_size, size=(batch, r))
        response_mask = np.ones((batch, r), dtype=np.float64)
        old_log_probs = -self._rng.uniform(0.1, 3.0, size=(batch, r))
        group_ids = np.repeat(np.arange(num_prompts), group_size)
        return RolloutBatch(
            prompt_ids=prompt_ids,
            response_ids=response_ids,
            response_mask=response_mask,
            old_log_probs=old_log_probs,
            group_ids=group_ids,
        )


# ----------------------------------------------------------------------------
# Reward registry + the null stub
# ----------------------------------------------------------------------------
register_reward, get_reward_fn, REWARD_REGISTRY = make_registry("reward function")


@register_reward("null")
def null_reward(sample: Sample, config=None) -> float:
    """Placeholder reward -- returns 0.0 for every sample (the stub to fill in).

    With an all-zero reward, GRPO advantages and the CISPO loss are 0 -- correct
    barebone behavior. Use the driver's ``--demo-random-reward`` to inject a
    signal without editing this stub.
    """
    return 0.0


# ----------------------------------------------------------------------------
# Trainer (mock)
# ----------------------------------------------------------------------------
class PolliusTrainer:
    def __init__(self, config: PolliusConfig, rollout: Rollout) -> None:
        self.config = config
        self.rollout = rollout
        self.reward_fn = get_reward_fn(config.reward_fn)
        self.advantage_fn = get_advantage_fn(config.adv_estimator)
        self.policy_loss_fn = get_policy_loss_fn(config.policy_loss)
        self._rng = np.random.default_rng(config.seed + 1)

    def _current_log_probs(self, batch: RolloutBatch) -> np.ndarray:
        """Mock 'current policy': perturb rollout log-probs so the IS ratio ~1."""
        noise = self._rng.uniform(-0.15, 0.15, size=batch.old_log_probs.shape)
        return batch.old_log_probs + noise

    def _optimizer_step(self, loss: float) -> None:
        """No real parameters -> logged no-op (real: loss.backward(); step())."""

    def train_step(self) -> LossMetrics:
        cfg = self.config
        batch = self.rollout.generate(cfg.num_prompts_per_step, cfg.group_size)
        rewards = np.array(
            [self.reward_fn(s, cfg) for s in batch.samples()], dtype=np.float64
        )
        batch.rewards = rewards
        batch.advantages = self.advantage_fn(
            rewards, batch.group_ids, batch.response_mask, cfg
        )
        log_probs = self._current_log_probs(batch)
        loss, metrics = self.policy_loss_fn(
            batch.old_log_probs, log_probs, batch.advantages, batch.response_mask, cfg
        )
        self._optimizer_step(loss)
        return metrics

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
