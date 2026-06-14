"""Torch (autograd) policy losses -- mirror pollius/losses.py for real training.

Same math and same numbers as the numpy versions, but built from torch ops so
the loss is differentiable through `log_prob`. The "stop-gradient" on CISPO's
clipped ratio is a real `.detach()` here. Returns ``(loss_tensor, LossMetrics)``.
"""

from __future__ import annotations

import torch

from pollius.registry import make_registry
from pollius.types import LossMetrics

register_torch_policy_loss, get_torch_policy_loss_fn, TORCH_POLICY_LOSS_REGISTRY = (
    make_registry("torch policy loss")
)


def masked_mean(values: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    denom = mask.sum()
    if float(denom) == 0.0:
        return values.sum() * 0.0
    return (values * mask).sum() / denom


def _ratio(log_prob, old_log_prob):
    neg_approx_kl = torch.clamp(log_prob - old_log_prob, -20.0, 20.0)
    return torch.exp(neg_approx_kl), neg_approx_kl


def _metrics(loss, ratio, clipped_ratio, neg_approx_kl, mask) -> LossMetrics:
    return LossMetrics(
        loss=float(loss.item()),
        clipfrac=float(masked_mean((ratio != clipped_ratio).float(), mask).item()),
        approx_kl=float(masked_mean(-neg_approx_kl, mask).item()),
        mean_ratio=float(masked_mean(ratio, mask).item()),
    )


@register_torch_policy_loss("cispo")
def cispo_loss(old_log_prob, log_prob, advantages, response_mask, config):
    ratio, neg_approx_kl = _ratio(log_prob, old_log_prob)
    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = torch.clamp(ratio, low, high)
    per_token_loss = -clipped_ratio.detach() * advantages * log_prob
    loss = masked_mean(per_token_loss, response_mask)
    return loss, _metrics(loss, ratio, clipped_ratio, neg_approx_kl, response_mask)


@register_torch_policy_loss("ppo")
def ppo_loss(old_log_prob, log_prob, advantages, response_mask, config):
    ratio, neg_approx_kl = _ratio(log_prob, old_log_prob)
    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = torch.clamp(ratio, low, high)
    per_token_loss = -torch.minimum(ratio * advantages, clipped_ratio * advantages)
    loss = masked_mean(per_token_loss, response_mask)
    return loss, _metrics(loss, ratio, clipped_ratio, neg_approx_kl, response_mask)


@register_torch_policy_loss("reinforce")
def reinforce_loss(old_log_prob, log_prob, advantages, response_mask, config):
    ratio, neg_approx_kl = _ratio(log_prob, old_log_prob)
    per_token_loss = -advantages * log_prob
    loss = masked_mean(per_token_loss, response_mask)
    return loss, _metrics(loss, ratio, ratio, neg_approx_kl, response_mask)
