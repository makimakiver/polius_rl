"""Rollout box -- the mocked part.

In a real framework this is where a policy model generates responses (vLLM /
SGLang / HF generate) and returns their log-probs. Here `MockRollout` fabricates
random token ids and random behavior log-probs so the rest of the pipeline runs
end-to-end with no model and no GPU. Swap in a real generator later by
implementing the same `generate(...)` shape.
"""

from __future__ import annotations

from typing import Protocol

import numpy as np

from pollius.types import RolloutBatch


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

        # behavior-policy log-probs: negative numbers in a plausible range.
        old_log_probs = -self._rng.uniform(0.1, 3.0, size=(batch, r))

        # group i contains the `group_size` samples drawn for prompt i.
        group_ids = np.repeat(np.arange(num_prompts), group_size)

        return RolloutBatch(
            prompt_ids=prompt_ids,
            response_ids=response_ids,
            response_mask=response_mask,
            old_log_probs=old_log_probs,
            group_ids=group_ids,
        )
