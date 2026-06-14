"""Advantage box -- turns per-sample rewards into the per-token learning signal.

CISPO is built on GRPO-style advantages, so this is the only estimator the
skeleton ships. It needs no critic/value model: the baseline is just the mean
reward of the other samples drawn for the same prompt.
"""

from __future__ import annotations

import numpy as np

from pollius.registry import make_registry

register_advantage, get_advantage_fn, ADVANTAGE_REGISTRY = make_registry(
    "advantage estimator"
)


@register_advantage("grpo")
def grpo_advantage(
    rewards: np.ndarray,        # (B,) one scalar reward per sample
    group_ids: np.ndarray,      # (B,) which prompt-group each sample belongs to
    response_mask: np.ndarray,  # (B, R) 1.0 for real tokens
    config,
) -> np.ndarray:
    """Group-normalized advantage, broadcast to every response token.

        A_i = (r_i - mean(group)) / (std(group) + eps)

    Then A_i is the same for all tokens of sample i (masked to real tokens).
    Returns an (B, R) array.
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

    # broadcast the per-sample scalar across the response, mask out padding
    return adv[:, None] * response_mask


@register_advantage("dr_grpo")
def dr_grpo_advantage(
    rewards: np.ndarray,
    group_ids: np.ndarray,
    response_mask: np.ndarray,
    config,
) -> np.ndarray:
    """Dr. GRPO: center by the group mean but DROP the std normalization.

        A_i = r_i - mean(group)

    Removing the per-group std divide avoids the length/difficulty bias that
    std-normalization introduces (Liu et al., "Understanding R1-Zero"). Same
    shape contract as `grpo_advantage`; ignores `config.grpo_std_norm`.
    """
    rewards = np.asarray(rewards, dtype=np.float64)
    adv = np.zeros_like(rewards)
    for g in np.unique(group_ids):
        members = group_ids == g
        group_rewards = rewards[members]
        adv[members] = group_rewards - group_rewards.mean()
    return adv[:, None] * response_mask


@register_advantage("rloo")
def rloo_advantage(
    rewards: np.ndarray,
    group_ids: np.ndarray,
    response_mask: np.ndarray,
    config,
) -> np.ndarray:
    """REINFORCE Leave-One-Out: baseline is the mean of the *other* samples.

        A_i = r_i - mean_{j != i, same group} r_j

    An unbiased per-sample baseline with slightly lower variance than using the
    full-group mean. Needs group_size >= 2 (guaranteed by PolliusConfig).
    """
    rewards = np.asarray(rewards, dtype=np.float64)
    adv = np.zeros_like(rewards)
    for g in np.unique(group_ids):
        members = group_ids == g
        group_rewards = rewards[members]
        n = group_rewards.shape[0]
        loo_mean = (group_rewards.sum() - group_rewards) / (n - 1)
        adv[members] = group_rewards - loo_mean
    return adv[:, None] * response_mask


@register_advantage("reinforce")
def reinforce_advantage(
    rewards: np.ndarray,
    group_ids: np.ndarray,
    response_mask: np.ndarray,
    config,
) -> np.ndarray:
    """Plain REINFORCE: no baseline at all, A_i = r_i.

    Highest variance; the trivial baseline to compare the others against.
    """
    rewards = np.asarray(rewards, dtype=np.float64)
    return rewards[:, None] * response_mask
