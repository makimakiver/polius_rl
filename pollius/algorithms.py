"""The shared math boxes: advantage (GRPO), policy loss (CISPO), and pass@k.

These are numpy and backend-agnostic -- the mock trainer and the torch trainer
both use the advantage estimator and metric from here; the torch trainer swaps in
the autograd CISPO from backends.torch_llm. Each box is its own name->function
registry, so a new algorithm is one decorated function.
"""

from __future__ import annotations

from math import comb
from typing import Dict, Tuple

import numpy as np

from pollius.core import LossMetrics
from pollius.registry import make_registry

# ----------------------------------------------------------------------------
# Advantage estimators
# ----------------------------------------------------------------------------
register_advantage, get_advantage_fn, ADVANTAGE_REGISTRY = make_registry(
    "advantage estimator"
)


@register_advantage("grpo")
def grpo_advantage(rewards, group_ids, response_mask, config):
    """Group-normalized advantage, broadcast to every response token.

        A_i = (r_i - mean(group)) / (std(group) + eps)
    """
    rewards = np.asarray(rewards, dtype=np.float64)
    adv = np.zeros_like(rewards)
    for g in np.unique(group_ids):
        members = group_ids == g
        group_rewards = rewards[members]
        centered = group_rewards - group_rewards.mean()
        if config.grpo_std_norm:
            centered = centered / (group_rewards.std() + config.adv_eps)
        adv[members] = centered
    return adv[:, None] * response_mask


# ----------------------------------------------------------------------------
# Policy losses (numpy) -- CISPO
# ----------------------------------------------------------------------------
register_policy_loss, get_policy_loss_fn, POLICY_LOSS_REGISTRY = make_registry(
    "policy loss"
)


def masked_mean(values, mask):
    """Mean over masked (valid) entries; 0.0 if the mask is empty."""
    denom = mask.sum()
    if denom == 0:
        return 0.0
    return float((values * mask).sum() / denom)


@register_policy_loss("cispo")
def cispo_loss(old_log_prob, log_prob, advantages, response_mask, config):
    """CISPO surrogate loss + metrics. Returns ``(loss: float, LossMetrics)``.

    Clips only the IS weight and uses it as a stop-gradient constant, so every
    token keeps its gradient through log_prob (unlike PPO, which zeros clipped
    tokens). arXiv:2506.13585.
    """
    neg_approx_kl = np.clip(log_prob - old_log_prob, -20.0, 20.0)
    ratio = np.exp(neg_approx_kl)
    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = np.clip(ratio, low, high)          # stop-grad IS weight
    per_token_loss = -clipped_ratio * advantages * log_prob
    loss = masked_mean(per_token_loss, response_mask)
    metrics = LossMetrics(
        loss=loss,
        clipfrac=masked_mean((ratio != clipped_ratio).astype(np.float64), response_mask),
        approx_kl=masked_mean(-neg_approx_kl, response_mask),
        mean_ratio=masked_mean(ratio, response_mask),
    )
    return loss, metrics


# ----------------------------------------------------------------------------
# Evaluation metric -- pass@k (unbiased Codex estimator)
# ----------------------------------------------------------------------------
def _pass_at_k_single(n: int, c: int, k: int) -> float:
    if k > n:
        return float("nan")
    if c == 0:
        return 0.0
    if n - c < k:        # too few failures to fill k slots -> a pass is guaranteed
        return 1.0
    return 1.0 - comb(n - c, k) / comb(n, k)


def pass_at_k(rewards, group_ids, k: int) -> Tuple[Dict, float]:
    """Per-problem pass@k = 1 - C(n-c, k) / C(n, k), and the mean over problems.

    Any reward > 0 counts as a pass; groups with n < k are NaN and excluded.
    """
    rewards = np.asarray(rewards, dtype=np.float64)
    group_ids = np.asarray(group_ids)
    per_problem: Dict = {}
    for g in np.unique(group_ids):
        members = group_ids == g
        n = int(members.sum())
        c = int((rewards[members] > 0).sum())
        key = g.item() if hasattr(g, "item") else g
        per_problem[key] = _pass_at_k_single(n, c, k)
    valid = [v for v in per_problem.values() if not np.isnan(v)]
    mean = float(np.mean(valid)) if valid else float("nan")
    return per_problem, mean
