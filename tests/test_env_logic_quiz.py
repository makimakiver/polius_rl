"""Tests for LogicQuizEnv. Run: python3 -m pytest tests/test_env_logic_quiz.py -q"""

from __future__ import annotations

import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.core import PolliusConfig
from pollius.environments.base import ENVIRONMENT_REGISTRY
from pollius.environments.logic_quiz import LogicQuizEnv, _extract_answer


def test_logic_quiz_is_registered():
    assert "logic_quiz" in ENVIRONMENT_REGISTRY


def test_sample_tasks_reads_json():
    env = LogicQuizEnv(PolliusConfig(data_dir="data"))
    tasks = env.sample_tasks(2, np.random.default_rng(0))
    by_id = {t.problem_id: t for t in tasks}
    assert by_id["parity"].extra["answer"] == "odd"
    assert by_id["next_num"].extra["answer"] == "10"
    assert all(t.env == "logic_quiz" for t in tasks)


def test_extract_answer_picks_last_answer_line():
    assert _extract_answer("blah\nAnswer: Odd") == "odd"
    assert _extract_answer("Answer: even\nthen Answer: odd") == "odd"
    assert _extract_answer("no marker here\n10") == "10"


def test_reward_matches_answer():
    env = LogicQuizEnv(PolliusConfig(data_dir="data"))
    task = [t for t in env.sample_tasks(2, np.random.default_rng(0)) if t.problem_id == "parity"][0]
    assert env.reward(task, "I think Answer: odd", PolliusConfig()) == 1.0
    assert env.reward(task, "Answer: even", PolliusConfig()) == 0.0
