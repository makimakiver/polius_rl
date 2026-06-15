"""Run: python3 -m pytest tests/test_policy.py -q

The real-model tests download Qwen (~1GB); they only run when
POLLIUS_RUN_TORCH_E2E=1. The device-selection and GenGroup tests always run.
"""

from __future__ import annotations

import math
import os
import sys

import pytest
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.core import PolliusConfig
from pollius.backends.torch_llm import GenGroup, _select_device

E2E = os.environ.get("POLLIUS_RUN_TORCH_E2E") == "1"


def test_select_device_explicit_cpu():
    assert _select_device("cpu") == torch.device("cpu")


def test_select_device_auto_returns_a_device():
    dev = _select_device("auto")
    assert isinstance(dev, torch.device)
    assert dev.type in ("mps", "cuda", "cpu")


def test_gengroup_holds_fields():
    g = GenGroup(response_texts=["a"], sequences=torch.zeros(1, 3), prompt_len=1,
                 response_mask=torch.ones(1, 2))
    assert g.response_texts == ["a"] and g.prompt_len == 1


@pytest.mark.skipif(not E2E, reason="set POLLIUS_RUN_TORCH_E2E=1 to run (downloads Qwen)")
def test_real_generate_and_logprobs_shapes():
    from pollius.backends.torch_llm import TorchPolicy
    cfg = PolliusConfig(max_new_tokens=8)
    policy = TorchPolicy(cfg)
    gen = policy.generate("Reply with 'Answer: yes'.", group_size=2)
    assert len(gen.response_texts) == 2
    lp = policy.logprobs(gen)
    assert lp.shape == gen.response_mask.shape
    assert torch.isfinite(lp).all()
