"""Policy-loss box -- this is the only box CISPO touches.

CISPO (Clipped IS-weight Policy Optimization, MiniMax-M1, arXiv:2506.13585)
differs from PPO/GRPO in *how the importance ratio enters the loss*:

    PPO:   loss = -min(ratio * A, clip(ratio) * A)      # clipped tokens get 0 grad
    CISPO: loss = -stopgrad(clip(ratio)) * A * log_prob  # every token keeps its grad

The clipped ratio is used only as a (detached) scalar weight; the gradient flows
entirely through `log_prob`. So no token is ever zeroed out by clipping -- the
key property CISPO is after.
"""

from __future__ import annotations

import numpy as np

from pollius.registry import make_registry
from pollius.types import LossMetrics

register_policy_loss, get_policy_loss_fn, POLICY_LOSS_REGISTRY = make_registry(
    "policy loss"
)


def masked_mean(values: np.ndarray, mask: np.ndarray) -> float:
    """Mean over masked (valid) entries; 0.0 if the mask is empty."""
    denom = mask.sum()
    if denom == 0:
        return 0.0
    return float((values * mask).sum() / denom)


@register_policy_loss("cispo")
def cispo_loss(
    old_log_prob: np.ndarray,   # (B, R) behavior-policy log-probs (from rollout)
    log_prob: np.ndarray,       # (B, R) current-policy log-probs
    advantages: np.ndarray,     # (B, R) from the advantage box
    response_mask: np.ndarray,  # (B, R)
    config,
):
    """Compute the CISPO surrogate loss and reporting metrics.

    Returns ``(loss: float, metrics: LossMetrics)``.

    numpy note: numpy has no autograd, so the "stop-gradient" on the clipped
    ratio is implicit -- we simply use it as a constant weight. In a real torch
    trainer this line is ``clipped = torch.clamp(ratio, ...).detach()`` and the
    loss stays differentiable through ``log_prob``. The numbers are identical.
    """
    # importance ratio  r = pi_current / pi_rollout, clamped in log-space for safety
    neg_approx_kl = np.clip(log_prob - old_log_prob, -20.0, 20.0)
    ratio = np.exp(neg_approx_kl)

    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = np.clip(ratio, low, high)  # the (would-be detached) IS weight

    # CISPO surrogate: gradient flows through log_prob only; clip is a weight.
    per_token_loss = -clipped_ratio * advantages * log_prob

    loss = masked_mean(per_token_loss, response_mask)

    metrics = LossMetrics(
        loss=loss,
        clipfrac=masked_mean((ratio != clipped_ratio).astype(np.float64), response_mask),
        approx_kl=masked_mean(-neg_approx_kl, response_mask),
        mean_ratio=masked_mean(ratio, response_mask),
    )
    return loss, metrics


def _ratio_and_kl(old_log_prob, log_prob):
    """Shared prep: importance ratio and the (negated) approx-KL term."""
    neg_approx_kl = np.clip(log_prob - old_log_prob, -20.0, 20.0)
    return np.exp(neg_approx_kl), neg_approx_kl


@register_policy_loss("ppo")
def ppo_loss(old_log_prob, log_prob, advantages, response_mask, config):
    """PPO / GRPO clipped surrogate -- the contrast CISPO is defined against.

        loss = -min(ratio * A, clip(ratio, 1-low, 1+high) * A)

    Where the clip binds, that token's gradient is zeroed (the very property
    CISPO avoids). Same signature and metrics as `cispo_loss`.
    """
    ratio, neg_approx_kl = _ratio_and_kl(old_log_prob, log_prob)
    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = np.clip(ratio, low, high)

    per_token_loss = -np.minimum(ratio * advantages, clipped_ratio * advantages)
    loss = masked_mean(per_token_loss, response_mask)

    metrics = LossMetrics(
        loss=loss,
        clipfrac=masked_mean((ratio != clipped_ratio).astype(np.float64), response_mask),
        approx_kl=masked_mean(-neg_approx_kl, response_mask),
        mean_ratio=masked_mean(ratio, response_mask),
    )
    return loss, metrics


@register_policy_loss("reinforce")
def reinforce_loss(old_log_prob, log_prob, advantages, response_mask, config):
    """Vanilla policy gradient: loss = -mean(A * log_prob). No ratio, no clip.

    `old_log_prob` is unused (on-policy assumption); kept in the signature so the
    trainer can call every loss identically.
    """
    ratio, neg_approx_kl = _ratio_and_kl(old_log_prob, log_prob)
    per_token_loss = -advantages * log_prob
    loss = masked_mean(per_token_loss, response_mask)

    metrics = LossMetrics(
        loss=loss,
        clipfrac=0.0,  # no clipping in vanilla PG
        approx_kl=masked_mean(-neg_approx_kl, response_mask),
        mean_ratio=masked_mean(ratio, response_mask),
    )
    return loss, metrics


@register_policy_loss("gspo")
def gspo_loss(old_log_prob, log_prob, advantages, response_mask, config):
    """GSPO (Qwen, arXiv:2507.18071): sequence-level importance ratio.

    The ratio is computed from the *sequence-averaged* log-prob difference (one
    scalar per sample) instead of per token, cutting the variance per-token
    ratios inject in long generations. The clipped surrogate is then PPO-shaped.
    """
    neg_approx_kl = np.clip(log_prob - old_log_prob, -20.0, 20.0)

    # per-sequence mean log-ratio over valid tokens -> (B, 1), broadcast back
    tok = neg_approx_kl * response_mask
    seq_len = np.clip(response_mask.sum(axis=1, keepdims=True), 1.0, None)
    seq_logr = tok.sum(axis=1, keepdims=True) / seq_len
    ratio = np.exp(seq_logr)  # (B, 1)

    low, high = 1.0 - config.clip_ratio_low, 1.0 + config.clip_ratio_high
    clipped_ratio = np.clip(ratio, low, high)

    per_token_loss = -np.minimum(ratio * advantages, clipped_ratio * advantages)
    loss = masked_mean(per_token_loss, response_mask)

    metrics = LossMetrics(
        loss=loss,
        clipfrac=masked_mean(
            np.broadcast_to(ratio != clipped_ratio, response_mask.shape).astype(np.float64),
            response_mask,
        ),
        approx_kl=masked_mean(-neg_approx_kl, response_mask),
        mean_ratio=masked_mean(np.broadcast_to(ratio, response_mask.shape), response_mask),
    )
    return loss, metrics
