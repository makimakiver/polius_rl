"""Tests for pass@k. Run: python3 -m pytest tests/test_metrics.py -q"""

from __future__ import annotations

import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pollius.metrics import pass_at_k


def test_pass_at_1_is_fraction_correct():
    rewards = np.array([1.0, 1.0, 0.0, 0.0, 0.0])
    groups = np.array([0, 0, 0, 0, 0])
    per_problem, mean = pass_at_k(rewards, groups, k=1)
    assert math.isclose(per_problem[0], 0.4)
    assert math.isclose(mean, 0.4)


def test_pass_at_k_equals_one_when_k_covers_all():
    rewards = np.array([1.0, 1.0, 0.0, 0.0, 0.0])
    groups = np.array([0, 0, 0, 0, 0])
    _, mean = pass_at_k(rewards, groups, k=5)
    assert math.isclose(mean, 1.0)


def test_pass_at_k_zero_when_none_correct():
    rewards = np.zeros(4)
    groups = np.array([0, 0, 0, 0])
    per_problem, mean = pass_at_k(rewards, groups, k=2)
    assert per_problem[0] == 0.0 and mean == 0.0


def test_pass_at_k_averages_over_problems():
    rewards = np.array([1.0, 0.0, 0.0, 0.0])
    groups = np.array([0, 0, 1, 1])
    _, mean = pass_at_k(rewards, groups, k=1)
    assert math.isclose(mean, 0.25)


def test_pass_at_k_skips_groups_smaller_than_k():
    rewards = np.array([1.0, 0.0])
    groups = np.array([0, 0])
    per_problem, mean = pass_at_k(rewards, groups, k=5)
    assert math.isnan(per_problem[0])
    assert math.isnan(mean)


def test_pass_at_k_accepts_string_group_ids():
    rewards = np.array([1.0, 0.0, 0.0, 0.0])
    groups = np.array(["parity", "parity", "next_num", "next_num"])
    per_problem, mean = pass_at_k(rewards, groups, k=1)
    assert per_problem["parity"] == 0.5
    assert per_problem["next_num"] == 0.0
    assert math.isclose(mean, 0.25)
