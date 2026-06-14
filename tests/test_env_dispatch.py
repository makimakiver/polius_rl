"""Tests for env dispatch. Run: python3 -m pytest tests/test_env_dispatch.py -q"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig
from pollius.environments.base import Task
from pollius.environments.dispatch import compute_rewards, load_environments


def test_load_environments_instantiates_by_name():
    envs = load_environments(("logic_quiz",), PolliusConfig(data_dir="data"))
    assert "logic_quiz" in envs
    assert envs["logic_quiz"].name == "logic_quiz"


def test_compute_rewards_dispatches_per_task_env():
    cfg = PolliusConfig(data_dir="data")
    envs = load_environments(("logic_quiz",), cfg)
    task = Task("logic_quiz", "parity", "q", {"answer": "odd"})
    tasks = [task, task]
    responses = ["Answer: odd", "Answer: even"]
    rewards = compute_rewards(tasks, responses, envs, cfg)
    assert rewards == [1.0, 0.0]


def test_compute_rewards_raises_on_unknown_env():
    cfg = PolliusConfig(data_dir="data")
    envs = load_environments(("logic_quiz",), cfg)
    tasks = [Task("nope", "x", "q", {})]
    import pytest
    with pytest.raises(KeyError):
        compute_rewards(tasks, ["whatever"], envs, cfg)
