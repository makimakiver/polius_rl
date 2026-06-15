"""Proves a NEW environment is added by just dropping a file in (no wiring).

Run: python3 -m pytest tests/test_env_keyword.py -q
"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.core import PolliusConfig
from pollius.environments.base import ENVIRONMENT_REGISTRY
from pollius.environments.dispatch import load_environments  # triggers auto-discovery


def test_new_env_is_autodiscovered_without_wiring():
    # `keyword` was added by dropping pollius/environments/keyword.py in --
    # dispatch.py was NOT edited, yet the env is registered.
    assert "keyword" in ENVIRONMENT_REGISTRY


def test_keyword_env_loads_and_verifies():
    cfg = PolliusConfig(data_dir="data")
    env = load_environments(("keyword",), cfg)["keyword"]
    task = env.sample_tasks(1, np.random.default_rng(0))[0]
    kw = task.extra["keyword"]
    assert env.reward(task, f"The answer is {kw}.", cfg) == 1.0
    assert env.reward(task, "I have no idea.", cfg) == 0.0
