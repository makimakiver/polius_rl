"""Run: python3 -m pytest tests/test_config_torch.py -q"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig


def test_torch_config_defaults():
    c = PolliusConfig()
    assert c.model_name == "Qwen/Qwen2.5-0.5B-Instruct"
    assert c.device == "auto"
    assert c.max_new_tokens == 64
    assert c.temperature == 1.0
    assert c.top_p == 1.0
    assert c.grad_clip == 1.0
