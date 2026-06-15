"""Policy-loss box -- CISPO (Clipped IS-weight Policy Optimization, arXiv:2506.13585).

Unlike PPO (which clips the surrogate and can zero a token's gradient), CISPO
clips only the IS weight and uses it as a stop-gradient constant, so every token
keeps its gradient through log_prob.
"""

from __future__ import annotations

import numpy as np

from pollius.registry import make_registry
from pollius.types import LossMetrics

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
    """CISPO surrogate loss + metrics. Returns ``(loss: float, LossMetrics)``."""
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
