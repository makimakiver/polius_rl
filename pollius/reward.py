"""Reward box -- the empty stub you fill in later.

A reward function maps one `Sample` (prompt + response) to a scalar. That scalar
is the *only* thing the rest of the pipeline learns from. Register a new one with
`@register_reward("name")` and point `PolliusConfig.reward_fn` at it.
"""

from __future__ import annotations

from pollius.registry import make_registry
from pollius.types import Sample

register_reward, get_reward_fn, REWARD_REGISTRY = make_registry("reward function")


@register_reward("null")
def null_reward(sample: Sample, config=None) -> float:
    """Placeholder reward -- intentionally returns 0.0 for every sample.

    This is the stub to fill in. Replace the body with real scoring, e.g.::

        text = decode(sample.response_ids)
        return 1.0 if is_correct(text) else 0.0

    Note: with an all-zero reward, GRPO advantages are all 0 and the CISPO loss
    is 0 -- correct, expected barebone behavior. Use the driver's
    ``--demo-random-reward`` flag to inject a non-zero signal and watch the
    pipeline move, without editing this stub.
    """
    return 0.0
