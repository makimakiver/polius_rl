"""Advantage box -- per-sample rewards into the per-token learning signal.

GRPO: no critic; the baseline is the group mean of the samples drawn for the
same prompt.
"""

from __future__ import annotations

import numpy as np

from pollius.registry import make_registry

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
