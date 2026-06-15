"""Torch (autograd) CISPO loss -- mirrors pollius/losses.py for real training.

Same numbers as the numpy version, but differentiable through log_prob; CISPO's
stop-gradient on the clipped ratio is a real ``.detach()``. Returns
``(loss_tensor, LossMetrics)``.
"""

from __future__ import annotations

import torch

from pollius.registry import make_registry
from pollius.types import LossMetrics

register_torch_policy_loss, get_torch_policy_loss_fn, TORCH_POLICY_LOSS_REGISTRY = (
    make_registry("torch policy loss")
)


def masked_mean(values, mask):
    denom = mask.sum()
    if float(denom) == 0.0:
        return values.sum() * 0.0
    return (values * mask).sum() / denom


@register_torch_policy_loss("cispo")
def cispo_loss(old_log_prob, log_prob, advantages, response_mask, config):
    neg_approx_kl = torch.clamp(log_prob - old_log_prob, -20.0, 20.0)
    ratio = torch.exp(neg_approx_kl)
    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = torch.clamp(ratio, low, high)
    per_token_loss = -clipped_ratio.detach() * advantages * log_prob
    loss = masked_mean(per_token_loss, response_mask)
    metrics = LossMetrics(
        loss=float(loss.item()),
        clipfrac=float(masked_mean((ratio != clipped_ratio).float(), response_mask).item()),
        approx_kl=float(masked_mean(-neg_approx_kl, response_mask).item()),
        mean_ratio=float(masked_mean(ratio, response_mask).item()),
    )
    return loss, metrics
