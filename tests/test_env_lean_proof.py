"""Tests for LeanProofEnv. Run: python3 -m pytest tests/test_env_lean_proof.py -q"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.config import PolliusConfig
from pollius.environments.base import ENVIRONMENT_REGISTRY
from pollius.environments.lean_proof import LeanProofEnv


def test_lean_proof_is_registered():
    assert "lean_proof" in ENVIRONMENT_REGISTRY


def test_sample_tasks_reads_problem_folders():
    env = LeanProofEnv(PolliusConfig(data_dir="data"))
    tasks = env.sample_tasks(2, np.random.default_rng(0))
    ids = sorted(t.problem_id for t in tasks)
    assert ids == ["add_zero", "mul_one"]
    for t in tasks:
        assert t.env == "lean_proof"
        assert "header" in t.extra and "theorem" in t.extra["header"]
        assert t.prompt  # non-empty


def test_sample_tasks_empty_when_dir_missing():
    env = LeanProofEnv(PolliusConfig(data_dir="does_not_exist"))
    assert env.sample_tasks(3, np.random.default_rng(0)) == []


def test_reward_raises_without_lake(monkeypatch):
    from pollius import verifier as V
    monkeypatch.setattr(V.shutil, "which", lambda _: None)
    env = LeanProofEnv(PolliusConfig(data_dir="data"))
    task = env.sample_tasks(1, np.random.default_rng(0))[0]
    import pytest
    with pytest.raises(RuntimeError):
        env.reward(task, "by simp", PolliusConfig(data_dir="data"))
